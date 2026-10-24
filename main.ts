import {
	App,
	Component,
	Plugin,
	PluginSettingTab,
	Setting,
	SettingDefinitionItem,
	editorLivePreviewField,
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
	MarkdownRenderer,
	MarkdownView,
	debounce,
} from "obsidian";
import {
	EditorView,
	Decoration,
	DecorationSet,
	ViewPlugin,
	ViewUpdate,
	WidgetType,
	gutter,
	GutterMarker,
} from "@codemirror/view";
import {
	EditorState,
	Range,
	StateField,
	StateEffect,
	Prec,
	Text as CMText,
} from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";

const CLOZE_REGEX =
	/\{\{([cC]?\d+)::((?:[^\n}]|\}(?!\}\}))+?)(?:::((?:[^\n}]|\}(?!\}\}))+?))?\}\}/g;
const ADDED_REGEX = /^\s*(?:>+\s*)?(?:[-*+]\s+|\d+\.\s+)?ADDED:/i;
const DELETED_REGEX =
	/^\s*(?:>+\s*)?(?:[-*+]\s+|\d+\.\s+)?(?:DELETED|DELTED):/i;

const CARD_TYPE_REGEX =
	/^(\s*(?:(?:ADDED|DELETED|DELTED):\s*)?)(Image Cloze|Cloze)(?::)?\s*$/i;
const EQL_REGEX =
	/^(\s*(?:(?:ADDED|DELETED|DELTED):\s*)?(?:[-*+]\s+|\d+\.\s+)?)(EQL:\s*)/i;

type BlockStatusType = "added" | "deleted";

interface CardBlock {
	id: number;
	type: BlockStatusType;
	fromLine: number;
	toLine: number;
	fromPos?: number;
	toPos?: number;
}

interface BlockLineInfo {
	blockId: number;
	type: BlockStatusType;
	isFirst: boolean;
	isLast: boolean;
}

export interface ParsedStatus {
	blocks: CardBlock[];
	lineMap: Map<number, BlockLineInfo>;
	cardHeaderLines: Set<number>;
	totalCardCount: number;
}

interface AnkiCardStylingSettings {
	enableClozeHighlighting: boolean;
	enableStatusHighlighting: boolean;
	enableCardDimming: boolean;
	enableCardTypeBadges: boolean;
	enableEqlTagBadges: boolean;
	enableStatusBar: boolean;
}

const DEFAULT_SETTINGS: AnkiCardStylingSettings = {
	enableClozeHighlighting: true,
	enableStatusHighlighting: true,
	enableCardDimming: true,
	enableCardTypeBadges: true,
	enableEqlTagBadges: true,
	enableStatusBar: true,
};

let currentSettings: AnkiCardStylingSettings = DEFAULT_SETTINGS;
const updateSettingsEffect = StateEffect.define<AnkiCardStylingSettings>();

const settingsField = StateField.define<AnkiCardStylingSettings>({
	create() {
		return currentSettings;
	},
	update(value, tr) {
		for (const effect of tr.effects) {
			if (effect.is(updateSettingsEffect)) {
				return effect.value;
			}
		}
		return value;
	},
});

const setHoveredBlockEffect = StateEffect.define<number | null>();

const hoveredBlockField = StateField.define<number | null>({
	create() {
		return null;
	},
	update(value, tr) {
		for (const effect of tr.effects) {
			if (effect.is(setHoveredBlockEffect)) {
				return effect.value;
			}
		}
		return value;
	},
});

class ClozeBadgeWidget extends WidgetType {
	constructor(private readonly clozeId: string) {
		super();
	}

	eq(other: ClozeBadgeWidget): boolean {
		return other.clozeId === this.clozeId;
	}

	toDOM(): HTMLElement {
		return createSpan({
			cls: "anki-cloze-badge",
			text: this.clozeId,
		});
	}

	ignoreEvent(): boolean {
		return false;
	}
}

class CardTypeBadgeWidget extends WidgetType {
	constructor(
		private readonly label: string,
		private readonly extraClass?: string
	) {
		super();
	}

	eq(other: CardTypeBadgeWidget): boolean {
		return (
			other.label === this.label && other.extraClass === this.extraClass
		);
	}

	toDOM(): HTMLElement {
		return createSpan({
			cls:
				"anki-card-type-badge" +
				(this.extraClass ? ` ${this.extraClass}` : ""),
			text: this.label,
		});
	}

	ignoreEvent(): boolean {
		return false;
	}
}

class ClozeHintWidget extends WidgetType {
	constructor(private readonly hint: string) {
		super();
	}

	eq(other: ClozeHintWidget): boolean {
		return other.hint === this.hint;
	}

	toDOM(): HTMLElement {
		return createSpan({
			cls: "anki-cloze-hint",
			text: `[${this.hint}]`,
		});
	}
}

class EmptyGutterMarker extends GutterMarker {
	elementClass = "anki-status-gutter-empty";

	toDOM(): HTMLElement {
		return createDiv();
	}

	eq(other: GutterMarker): boolean {
		return other instanceof EmptyGutterMarker;
	}
}

const emptyGutterMarker = new EmptyGutterMarker();

class StatusGutterMarker extends GutterMarker {
	elementClass: string;

	constructor(
		readonly type: BlockStatusType,
		readonly isFirst: boolean,
		readonly isLast: boolean
	) {
		super();
		const classes = [
			"anki-status-gutter-element",
			`anki-status-${this.type}`,
		];
		if (this.isFirst) classes.push("is-first");
		if (this.isLast) classes.push("is-last");
		this.elementClass = classes.join(" ");
	}

	eq(other: GutterMarker): boolean {
		return (
			other instanceof StatusGutterMarker &&
			this.type === other.type &&
			this.isFirst === other.isFirst &&
			this.isLast === other.isLast
		);
	}

	toDOM(): HTMLElement {
		return createDiv({ cls: "anki-status-gutter-bar" });
	}
}

const STATIC_MARKERS = new Map<string, StatusGutterMarker>();
for (const type of ["added", "deleted"] as BlockStatusType[]) {
	for (const isFirst of [false, true]) {
		for (const isLast of [false, true]) {
			STATIC_MARKERS.set(
				`${type}-${isFirst}-${isLast}`,
				new StatusGutterMarker(type, isFirst, isLast)
			);
		}
	}
}

function getCachedMarker(
	type: BlockStatusType,
	isFirst: boolean,
	isLast: boolean
): StatusGutterMarker {
	return STATIC_MARKERS.get(`${type}-${isFirst}-${isLast}`)!;
}

function isThematicBreak(text: string): boolean {
	return (
		text.length >= 3 &&
		/^(?:(?:-\s*){3,}|(?:_\s*){3,}|(?:\*\s*){3,})$/.test(text)
	);
}

export function parseCardBlocks(lines: string[]): ParsedStatus {
	const blocks: CardBlock[] = [];
	const lineMap = new Map<number, BlockLineInfo>();
	const cardHeaderLines = new Set<number>();

	// 1. Identify and skip YAML Frontmatter strictly at line 0
	let startLineIdx = 0;
	if (lines.length > 0 && lines[0].trim() === "---") {
		let endFrontmatter = -1;
		let looksLikeCard = false;

		for (let i = 1; i < lines.length; i++) {
			const trimmed = lines[i].trim();
			if (trimmed === "---" || trimmed === "...") {
				endFrontmatter = i;
				break;
			}
			CLOZE_REGEX.lastIndex = 0;
			if (
				ADDED_REGEX.test(lines[i]) ||
				DELETED_REGEX.test(lines[i]) ||
				CLOZE_REGEX.test(lines[i]) ||
				/^\s*(?:Cloze|Image Cloze|EQL:)/i.test(trimmed)
			) {
				looksLikeCard = true;
				break;
			}
		}

		if (endFrontmatter !== -1 && !looksLikeCard) {
			startLineIdx = endFrontmatter + 1;
		}
	}

	// 2. Identify horizontal rules, ignoring fenced code blocks and frontmatter
	const hrIndices = new Set<number>();
	let inCodeBlock = false;
	let codeFenceChar = "";

	for (let i = startLineIdx; i < lines.length; i++) {
		const text = lines[i].trim();
		const fenceMatch = text.match(/^(?:`{3,}|~{3,})/);
		if (fenceMatch) {
			const fence = fenceMatch[0];
			if (!inCodeBlock) {
				inCodeBlock = true;
				codeFenceChar = fence[0];
			} else if (text.startsWith(codeFenceChar.repeat(3))) {
				inCodeBlock = false;
			}
			continue;
		}
		if (inCodeBlock) continue;

		if (isThematicBreak(text)) {
			hrIndices.add(i);
		}
	}

	// 3. Segment cards between hr lines
	const segments: [number, number][] = [];
	let segStart = startLineIdx;
	for (let i = startLineIdx; i < lines.length; i++) {
		if (hrIndices.has(i)) {
			if (i > segStart) {
				segments.push([segStart, i - 1]);
			}
			segStart = i + 1;
		}
	}
	if (segStart < lines.length) {
		segments.push([segStart, lines.length - 1]);
	}

	let nextBlockId = 0;
	let validSegmentsCount = 0;

	for (const [startIdx, endIdx] of segments) {
		let actualStart = startIdx;
		while (actualStart <= endIdx && !lines[actualStart].trim()) {
			actualStart++;
		}

		let actualEnd = endIdx;
		while (actualEnd >= actualStart && !lines[actualEnd].trim()) {
			actualEnd--;
		}

		if (actualStart > actualEnd) continue;

		validSegmentsCount++;
		// The first non-empty line after the HR is registered as cardHeaderLine
		cardHeaderLines.add(actualStart + 1);

		let statusType: BlockStatusType | null = null;
		for (let i = actualStart; i <= actualEnd; i++) {
			const t = lines[i];
			if (ADDED_REGEX.test(t)) {
				statusType = "added";
				break;
			}
			if (DELETED_REGEX.test(t)) {
				statusType = "deleted";
				break;
			}
		}

		if (!statusType) continue;

		const blockId = nextBlockId++;
		blocks.push({
			id: blockId,
			type: statusType,
			fromLine: actualStart + 1,
			toLine: actualEnd + 1,
		});

		for (let i = actualStart; i <= actualEnd; i++) {
			lineMap.set(i + 1, {
				blockId,
				type: statusType,
				isFirst: i === actualStart,
				isLast: i === actualEnd,
			});
		}
	}

	return {
		blocks,
		lineMap,
		cardHeaderLines,
		totalCardCount: validSegmentsCount,
	};
}

function parseStatusBlocksFromDoc(doc: CMText): ParsedStatus {
	if (!currentSettings.enableStatusHighlighting) {
		return {
			blocks: [],
			lineMap: new Map(),
			cardHeaderLines: new Set(),
			totalCardCount: 0,
		};
	}

	const lines: string[] = [];
	const lineOffsets: { from: number; to: number }[] = [];
	let currentPos = 0;

	for (const lineText of doc.iterLines()) {
		lines.push(lineText);
		lineOffsets.push({
			from: currentPos,
			to: currentPos + lineText.length,
		});
		currentPos += lineText.length + 1;
	}

	const parsed = parseCardBlocks(lines);
	for (const block of parsed.blocks) {
		const startOffset = lineOffsets[block.fromLine - 1];
		const endOffset = lineOffsets[block.toLine - 1];
		if (startOffset && endOffset) {
			block.fromPos = startOffset.from;
			block.toPos = endOffset.to;
		}
	}
	return parsed;
}

const statusBlocksField = StateField.define<ParsedStatus>({
	create(state) {
		return parseStatusBlocksFromDoc(state.doc);
	},
	update(value, tr) {
		if (tr.docChanged) {
			return parseStatusBlocksFromDoc(tr.state.doc);
		}
		return value;
	},
});

function getMarkerForPosition(view: EditorView, pos: number): GutterMarker {
	if (!view.state.field(editorLivePreviewField, false)) {
		return emptyGutterMarker;
	}
	const settings = view.state.field(settingsField);
	if (!settings.enableStatusHighlighting) {
		return emptyGutterMarker;
	}

	const doc = view.state.doc;
	if (pos < 0 || pos > doc.length) return emptyGutterMarker;

	const lineNum = doc.lineAt(pos).number;
	const parsed = view.state.field(statusBlocksField);
	const st = parsed.lineMap.get(lineNum);
	if (!st) {
		return emptyGutterMarker;
	}

	return getCachedMarker(st.type, st.isFirst, st.isLast);
}

function isCursorInRange(
	state: EditorState,
	from: number,
	to: number
): boolean {
	return state.selection.ranges.some(
		(range) => range.from <= to && range.to >= from
	);
}

function isIndexInInlineMath(lineText: string, index: number): boolean {
	let inMath = false;
	let mathStart = -1;
	for (let i = 0; i < lineText.length; i++) {
		if (lineText[i] === "$" && (i === 0 || lineText[i - 1] !== "\\")) {
			if (i + 1 < lineText.length && lineText[i + 1] === "$") {
				i++;
				inMath = !inMath;
				continue;
			}
			if (!inMath) {
				inMath = true;
				mathStart = i;
			} else {
				inMath = false;
				if (index >= mathStart && index <= i) {
					return true;
				}
			}
		}
	}
	return inMath && index >= mathStart;
}

function isPositionInLatex(state: EditorState, pos: number): boolean {
	try {
		const tree = syntaxTree(state);
		let node: SyntaxNode | null = tree.resolveInner(pos, 1);
		while (node) {
			const name = (node.name || "").toLowerCase();
			if (
				name.includes("math") ||
				name.includes("katex") ||
				name.includes("tex")
			) {
				return true;
			}
			node = node.parent;
		}
	} catch {
		// syntaxTree may be unavailable during early parsing
	}
	return false;
}

const ankiLivePreviewPlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = this.buildDecorations(view);
		}

		update(update: ViewUpdate) {
			const livePreviewChanged =
				update.startState.field(editorLivePreviewField, false) !==
				update.state.field(editorLivePreviewField, false);
			const settingsChanged = update.transactions.some((tr) =>
				tr.effects.some((e) => e.is(updateSettingsEffect))
			);
			const hoverChanged = update.transactions.some((tr) =>
				tr.effects.some((e) => e.is(setHoveredBlockEffect))
			);

			if (
				update.docChanged ||
				update.viewportChanged ||
				update.selectionSet ||
				livePreviewChanged ||
				settingsChanged ||
				hoverChanged
			) {
				this.decorations = this.buildDecorations(update.view);
			}
		}

		buildDecorations(view: EditorView): DecorationSet {
			const state = view.state;
			if (!state.field(editorLivePreviewField, false)) {
				return Decoration.none;
			}

			const settings = state.field(settingsField);
			const doc: CMText = state.doc;
			const parsed = state.field(statusBlocksField);
			const hoveredBlockId = state.field(hoveredBlockField, false);
			const decorations: Range<Decoration>[] = [];

			const activeBlockIds = new Set<number>();
			if (settings.enableStatusHighlighting) {
				for (const block of parsed.blocks) {
					const fromPos = block.fromPos ?? 0;
					const toPos = block.toPos ?? 0;
					const isActive = state.selection.ranges.some(
						(r) => r.from <= toPos && r.to >= fromPos
					);
					if (isActive) {
						activeBlockIds.add(block.id);
					}
				}
			}

			for (const { from, to } of view.visibleRanges) {
				const startLine = doc.lineAt(from).number;
				const endLine = doc.lineAt(to).number;

				for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
					const line = doc.line(lineNum);
					const blockStatus = parsed.lineMap.get(lineNum);

					// 1. Line-level status highlighting (gutter bar & dimming)
					if (settings.enableStatusHighlighting && blockStatus) {
						const isActive = activeBlockIds.has(blockStatus.blockId);
						const isHovered =
							hoveredBlockId !== null &&
							blockStatus.blockId === hoveredBlockId;

						const classes = [
							"anki-status-line",
							`anki-status-${blockStatus.type}`,
						];
						if (settings.enableCardDimming) {
							classes.push("anki-dimmed");
						}
						if (blockStatus.isFirst)
							classes.push("anki-status-line-first");
						if (blockStatus.isLast)
							classes.push("anki-status-line-last");
						if (isActive) classes.push("is-active");
						if (isHovered) classes.push("is-hovered");

						decorations.push(
							Decoration.line({
								attributes: {
									class: classes.join(" "),
									"data-anki-block-id": String(
										blockStatus.blockId
									),
								},
							}).range(line.from)
						);
					}

					// 2. Card Type Button Badges (Cloze / Image Cloze on first line after ---)
					if (
						settings.enableCardTypeBadges &&
						parsed.cardHeaderLines.has(lineNum)
					) {
						const cardTypeMatch = line.text.match(CARD_TYPE_REGEX);
						if (cardTypeMatch) {
							const prefix = cardTypeMatch[1];
							const keyword = cardTypeMatch[2];
							const badgeFrom = line.from + prefix.length;
							const badgeTo = badgeFrom + keyword.length;

							if (!isCursorInRange(state, badgeFrom, badgeTo)) {
								decorations.push(
									Decoration.replace({
										widget: new CardTypeBadgeWidget(
											keyword
										),
									}).range(badgeFrom, badgeTo)
								);
							}
						}
					}

					// 3. EQL Tag Badges (Lines starting with EQL:)
					const eqlMatch = settings.enableEqlTagBadges
						? line.text.match(EQL_REGEX)
						: null;
					if (eqlMatch) {
						const prefix = eqlMatch[1];
						const eqlToken = eqlMatch[2];
						const eqlFrom = line.from + prefix.length;
						const eqlTo = eqlFrom + eqlToken.length;

						if (!isCursorInRange(state, eqlFrom, eqlTo)) {
							decorations.push(
								Decoration.replace({
									widget: new CardTypeBadgeWidget(
										"EQL",
										"anki-tag-eql"
									),
								}).range(eqlFrom, eqlTo)
							);
						}
					}

					// 4. Cloze deletions ({{c1::...}})
					if (
						settings.enableClozeHighlighting &&
						line.text.includes("{{")
					) {
						CLOZE_REGEX.lastIndex = 0;
						let match: RegExpExecArray | null;

						while ((match = CLOZE_REGEX.exec(line.text)) !== null) {
							const fullMatch = match[0];
							const clozeId = match[1];
							const content = match[2];
							const hint = match[3];

							const clozeFrom = line.from + match.index;
							const clozeTo = clozeFrom + fullMatch.length;

							// Ignore clozes in LaTeX blocks/math
							if (
								isIndexInInlineMath(line.text, match.index) ||
								isPositionInLatex(state, clozeFrom)
							) {
								continue;
							}

							if (isCursorInRange(state, clozeFrom, clozeTo)) {
								continue;
							}

							const prefixEnd =
								clozeFrom + 2 + clozeId.length + 2;
							const contentEnd = prefixEnd + content.length;

							decorations.push(
								Decoration.replace({
									widget: new ClozeBadgeWidget(clozeId),
								}).range(clozeFrom, prefixEnd)
							);

							if (contentEnd > prefixEnd) {
								decorations.push(
									Decoration.mark({
										class: "anki-cloze-content",
									}).range(prefixEnd, contentEnd)
								);
							}

							if (hint !== undefined) {
								decorations.push(
									Decoration.replace({
										widget: new ClozeHintWidget(hint),
									}).range(contentEnd, clozeTo)
								);
							} else {
								decorations.push(
									Decoration.replace({}).range(
										contentEnd,
										clozeTo
									)
								);
							}
						}
					}
				}
			}

			return Decoration.set(decorations, true);
		}
	},
	{
		decorations: (v) => v.decorations,
		eventHandlers: {
			mouseover(event: MouseEvent, view: EditorView) {
				const target = event.target as HTMLElement | null;
				const blockEl = target?.closest(
					"[data-anki-block-id]"
				) as HTMLElement | null;
				const rawId = blockEl?.getAttribute("data-anki-block-id");
				const blockId =
					rawId !== undefined && rawId !== null ? Number(rawId) : null;
				const current = view.state.field(hoveredBlockField, false);
				if (current !== blockId) {
					view.dispatch({
						effects: setHoveredBlockEffect.of(blockId),
					});
				}
			},
			mouseleave(_event: MouseEvent, view: EditorView) {
				const current = view.state.field(hoveredBlockField, false);
				if (current !== null) {
					view.dispatch({
						effects: setHoveredBlockEffect.of(null),
					});
				}
			},
		},
	}
);

let readingViewCache: { text: string; parsed: ParsedStatus } | null = null;
function getCachedReadingBlocks(text: string): ParsedStatus {
	if (readingViewCache && readingViewCache.text === text) {
		return readingViewCache.parsed;
	}
	const lines = text.split("\n");
	const parsed = parseCardBlocks(lines);
	readingViewCache = { text, parsed };
	return parsed;
}

function renderCardTypeBadgesInElement(root: HTMLElement) {
	const pElements = root.querySelectorAll("p, div, li, h1, h2, h3, h4, h5, h6");
	const targets: HTMLElement[] =
		pElements.length > 0
			? (Array.from(pElements) as HTMLElement[])
			: [root];

	for (const target of targets) {
		const text = target.textContent?.trim() || "";
		const match = text.match(CARD_TYPE_REGEX);
		if (match) {
			const prefix = match[1];
			const keyword = match[2];

			target.empty();
			if (prefix.trim()) {
				target.appendText(prefix);
			}
			target.createSpan({
				cls: "anki-card-type-badge",
				text: keyword,
			});
		}
	}
}

function renderEqlBadgesInElement(root: HTMLElement) {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode(node) {
			const val = node.nodeValue;
			if (!val || !val.includes("EQL:")) return NodeFilter.FILTER_SKIP;
			const parent = node.parentElement;
			if (
				!parent ||
				parent.closest("code, pre, .anki-card-type-badge")
			) {
				return NodeFilter.FILTER_REJECT;
			}
			return EQL_REGEX.test(val)
				? NodeFilter.FILTER_ACCEPT
				: NodeFilter.FILTER_SKIP;
		},
	});

	const textNodes: Text[] = [];
	let currentNode: Node | null;
	while ((currentNode = walker.nextNode()) !== null) {
		textNodes.push(currentNode as Text);
	}

	for (const textNode of textNodes) {
		const val = textNode.nodeValue || "";
		const match = val.match(EQL_REGEX);
		if (!match) continue;

		const prefix = match[1];
		const rest = val.slice(match[0].length);

		const fragment = createFragment();
		if (prefix) {
			fragment.appendText(prefix);
		}
		fragment.createSpan({
			cls: "anki-card-type-badge anki-tag-eql",
			text: "EQL",
		});
		if (rest) {
			fragment.appendText(" " + rest.trimStart());
		}
		textNode.replaceWith(fragment);
	}
}

class ClozeRenderChild extends MarkdownRenderChild {
	constructor(
		containerEl: HTMLElement,
		private readonly appInstance: App,
		private readonly content: string,
		private readonly sourcePath: string
	) {
		super(containerEl);
	}

	onload(): void {
		void MarkdownRenderer.render(
			this.appInstance,
			this.content,
			this.containerEl,
			this.sourcePath,
			this
		);
	}
}

function renderClozesInElement(
	root: HTMLElement,
	app: App,
	ctx: MarkdownPostProcessorContext
) {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode(node) {
			const val = node.nodeValue;
			if (!val || !val.includes("{{")) return NodeFilter.FILTER_SKIP;
			const parent = node.parentElement;
			if (!parent) return NodeFilter.FILTER_REJECT;
			if (
				parent.closest(
					"code, pre, .anki-cloze, .math, .math-block, .math-inline, .katex, .MathJax, [class*='math']"
				)
			) {
				return NodeFilter.FILTER_REJECT;
			}
			CLOZE_REGEX.lastIndex = 0;
			return CLOZE_REGEX.test(val)
				? NodeFilter.FILTER_ACCEPT
				: NodeFilter.FILTER_SKIP;
		},
	});

	const textNodes: Text[] = [];
	let currentNode: Node | null;
	while ((currentNode = walker.nextNode()) !== null) {
		textNodes.push(currentNode as Text);
	}

	for (const textNode of textNodes) {
		const text = textNode.nodeValue || "";
		CLOZE_REGEX.lastIndex = 0;

		const fragment = createFragment();
		let lastIndex = 0;
		let match: RegExpExecArray | null;

		while ((match = CLOZE_REGEX.exec(text)) !== null) {
			if (isIndexInInlineMath(text, match.index)) {
				continue;
			}

			if (match.index > lastIndex) {
				fragment.appendText(text.slice(lastIndex, match.index));
			}

			const clozeId = match[1];
			const content = match[2];
			const hint = match[3];

			const wrapper = fragment.createSpan({ cls: "anki-cloze" });
			wrapper.createSpan({ cls: "anki-cloze-badge", text: clozeId });
			const contentSpan = wrapper.createSpan({ cls: "anki-cloze-content" });
			const child = new ClozeRenderChild(
				contentSpan,
				app,
				content,
				ctx.sourcePath
			);
			ctx.addChild(child);

			if (hint !== undefined) {
				wrapper.createSpan({ cls: "anki-cloze-hint", text: `[${hint}]` });
			}

			lastIndex = match.index + match[0].length;
		}

		if (lastIndex < text.length) {
			fragment.appendText(text.slice(lastIndex));
		}

		textNode.replaceWith(fragment);
	}
}

class AnkiCardStylingSettingTab extends PluginSettingTab {
	plugin: AnkiCardStylingPlugin;

	constructor(app: App, plugin: AnkiCardStylingPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem<keyof AnkiCardStylingSettings>[] {
		return [
			{
				name: "Cloze deletion highlighting",
				desc: "Formats Anki cloze deletions ({{c1::...}}) as rounded badges and reveals raw syntax when the cursor is inside.",
				control: {
					type: "toggle",
					key: "enableClozeHighlighting",
				},
			},
			{
				name: "Card status highlighting (ADDED / DELETED)",
				desc: "Displays a vertical side bar (green for ADDED, red for DELETED) in the editor gutter.",
				control: {
					type: "toggle",
					key: "enableStatusHighlighting",
				},
			},
			{
				name: "Dim inactive cards",
				desc: "Subtly dims synced or deleted cards (~62% opacity) until hovered or selected.",
				control: {
					type: "toggle",
					key: "enableCardDimming",
				},
			},
			{
				name: "Card type badge highlighting (Cloze / Image Cloze)",
				desc: "Renders 'Cloze' or 'Image Cloze' on the first line after a card divider as rounded pill buttons.",
				control: {
					type: "toggle",
					key: "enableCardTypeBadges",
				},
			},
			{
				name: "Extra Question Line tag highlighting (EQL)",
				desc: "Renders 'EQL:' (Extra Question Line) at the start of a line as a styled pill tag.",
				control: {
					type: "toggle",
					key: "enableEqlTagBadges",
				},
			},
			{
				name: "Status bar card counter",
				desc: "Displays real-time card counts (total, added, deleted) in Obsidian's status bar.",
				control: {
					type: "toggle",
					key: "enableStatusBar",
				},
			},
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const settingKey = key as keyof AnkiCardStylingSettings;
		if (typeof value === "boolean") {
			this.plugin.settings[settingKey] = value;
			await this.plugin.saveSettings();
		}
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Cloze deletion highlighting")
			.setDesc(
				"Formats Anki cloze deletions ({{c1::...}}) as rounded badges and reveals raw syntax when the cursor is inside."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableClozeHighlighting)
					.onChange(async (value) => {
						this.plugin.settings.enableClozeHighlighting = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Card status highlighting (ADDED / DELETED)")
			.setDesc(
				"Displays a vertical side bar (green for ADDED, red for DELETED) in the editor gutter."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableStatusHighlighting)
					.onChange(async (value) => {
						this.plugin.settings.enableStatusHighlighting = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Dim inactive cards")
			.setDesc(
				"Subtly dims synced or deleted cards (~62% opacity) until hovered or selected."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableCardDimming)
					.onChange(async (value) => {
						this.plugin.settings.enableCardDimming = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Card type badge highlighting (Cloze / Image Cloze)")
			.setDesc(
				"Renders 'Cloze' or 'Image Cloze' on the first line after a card divider as rounded pill buttons."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableCardTypeBadges)
					.onChange(async (value) => {
						this.plugin.settings.enableCardTypeBadges = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Extra Question Line tag highlighting (EQL)")
			.setDesc(
				"Renders 'EQL:' (Extra Question Line) at the start of a line as a styled pill tag."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableEqlTagBadges)
					.onChange(async (value) => {
						this.plugin.settings.enableEqlTagBadges = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Status bar card counter")
			.setDesc(
				"Displays real-time card counts (total, added, deleted) in Obsidian's status bar."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableStatusBar)
					.onChange(async (value) => {
						this.plugin.settings.enableStatusBar = value;
						await this.plugin.saveSettings();
					})
			);
	}
}

export default class AnkiCardStylingPlugin extends Plugin {
	settings: AnkiCardStylingSettings;
	private statusBarItem: HTMLElement | null = null;
	private currentHoveredReadingBlockId: string | null = null;
	private debouncedUpdateStatusBar = debounce(
		() => this.updateStatusBar(),
		300,
		true
	);

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new AnkiCardStylingSettingTab(this.app, this));

		this.registerEditorExtension([
			settingsField,
			statusBlocksField,
			hoveredBlockField,
			Prec.highest(
				gutter({
					class: "anki-status-gutter",
					renderEmptyElements: true,
					lineMarker(view, line) {
						return getMarkerForPosition(view, line.from);
					},
					widgetMarker(view, _widget, block) {
						return getMarkerForPosition(view, block.from);
					},
				})
			),
			ankiLivePreviewPlugin,
		]);

		// Reading View: Register delegated hover event listener once to prevent memory leaks
		this.registerDomEvent(document, "mouseover", (event: MouseEvent) => {
			const target = event.target as HTMLElement | null;
			const blockEl = target?.closest(
				".anki-status-reading-block[data-anki-block-id]"
			) as HTMLElement | null;
			const blockId = blockEl?.getAttribute("data-anki-block-id") ?? null;
			if (blockId === this.currentHoveredReadingBlockId) return;

			if (this.currentHoveredReadingBlockId !== null) {
				document
					.querySelectorAll(
						`.anki-status-reading-block[data-anki-block-id="${this.currentHoveredReadingBlockId}"]`
					)
					.forEach((b) => b.classList.remove("is-hovered"));
			}

			this.currentHoveredReadingBlockId = blockId;

			if (blockId !== null) {
				document
					.querySelectorAll(
						`.anki-status-reading-block[data-anki-block-id="${blockId}"]`
					)
					.forEach((b) => b.classList.add("is-hovered"));
			}
		});

		this.registerDomEvent(document, "mouseout", (event: MouseEvent) => {
			if (
				!event.relatedTarget &&
				this.currentHoveredReadingBlockId !== null
			) {
				document
					.querySelectorAll(
						`.anki-status-reading-block[data-anki-block-id="${this.currentHoveredReadingBlockId}"]`
					)
					.forEach((b) => b.classList.remove("is-hovered"));
				this.currentHoveredReadingBlockId = null;
			}
		});

		this.registerMarkdownPostProcessor(
			(el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
				// Render Cloze badges
				if (this.settings.enableClozeHighlighting) {
					renderClozesInElement(
						el,
						this.app,
						ctx
					);
				}

				// Render Cloze / Image Cloze buttons and EQL tags
				if (this.settings.enableCardTypeBadges) {
					renderCardTypeBadgesInElement(el);
				}
				if (this.settings.enableEqlTagBadges) {
					renderEqlBadgesInElement(el);
				}

				if (!this.settings.enableStatusHighlighting) return;

				const sectionInfo = ctx.getSectionInfo(el);
				if (!sectionInfo) return;
				if (el.querySelector("hr") || el.tagName === "HR") return;

				// Redundant reparsing solved via cached reading blocks
				const parsed = getCachedReadingBlocks(sectionInfo.text);

				let isStatusSection = false;
				let statusType: BlockStatusType | null = null;
				let blockId: number | null = null;
				let isFirst = false;
				let isLast = false;

				for (
					let lineNum = sectionInfo.lineStart + 1;
					lineNum <= sectionInfo.lineEnd + 1;
					lineNum++
				) {
					const status = parsed.lineMap.get(lineNum);
					if (status) {
						isStatusSection = true;
						statusType = status.type;
						blockId = status.blockId;
						if (status.isFirst) isFirst = true;
						if (status.isLast) isLast = true;
					}
				}

				if (isStatusSection && statusType && blockId !== null) {
					el.classList.add(
						"anki-status-line",
						"anki-status-reading-block",
						`anki-status-${statusType}`
					);
					if (this.settings.enableCardDimming) {
						el.classList.add("anki-dimmed");
					}
					el.setAttribute(
						"data-anki-block-id",
						`reading-${blockId}`
					);
					if (isFirst) el.classList.add("anki-status-line-first");
					if (isLast) el.classList.add("anki-status-line-last");
				}
			}
		);

		// Status Bar: Add summary card item and register reactive updates
		this.statusBarItem = this.addStatusBarItem();
		this.updateStatusBar();

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				this.updateStatusBar();
			})
		);
		this.registerEvent(
			this.app.workspace.on("editor-change", () => {
				this.debouncedUpdateStatusBar();
			})
		);
	}

	onunload() {
		if (this.statusBarItem) {
			this.statusBarItem.remove();
			this.statusBarItem = null;
		}
	}

	updateStatusBar(): void {
		if (!this.statusBarItem) return;
		if (!this.settings.enableStatusBar) {
			this.statusBarItem.setText("");
			this.statusBarItem.title = "";
			return;
		}
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			this.statusBarItem.setText("");
			return;
		}

		const docText = view.editor.getValue();
		if (!docText) {
			this.statusBarItem.setText("");
			return;
		}

		const lines = docText.split("\n");
		const parsed = parseCardBlocks(lines);

		const totalCards = parsed.totalCardCount;
		if (totalCards === 0) {
			this.statusBarItem.setText("");
			return;
		}

		const addedCount = parsed.blocks.filter(
			(b) => b.type === "added"
		).length;
		const deletedCount = parsed.blocks.filter(
			(b) => b.type === "deleted"
		).length;

		let text = `Anki: ${totalCards} card${totalCards === 1 ? "" : "s"}`;
		const details: string[] = [];
		if (addedCount > 0) details.push(`${addedCount} added`);
		if (deletedCount > 0) details.push(`${deletedCount} deleted`);
		if (details.length > 0) {
			text += ` (${details.join(", ")})`;
		}

		this.statusBarItem.setText(text);
		this.statusBarItem.title = `Anki Card Status: ${totalCards} total (${addedCount} ADDED, ${deletedCount} DELETED)`;
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<AnkiCardStylingSettings> | null
		);
		currentSettings = this.settings;
	}

	async saveSettings() {
		await this.saveData(this.settings);
		currentSettings = this.settings;
		this.updateAllViews();
		this.updateStatusBar();
	}

	private updateAllViews() {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (view instanceof MarkdownView) {
				const editorWithCm = view.editor as unknown as { cm?: EditorView };
				if (editorWithCm.cm) {
					editorWithCm.cm.dispatch({
						effects: updateSettingsEffect.of(this.settings),
					});
				}
				const viewWithPreview = view as unknown as {
					previewMode?: { rerender: (full?: boolean) => void };
				};
				if (
					viewWithPreview.previewMode &&
					typeof viewWithPreview.previewMode.rerender === "function"
				) {
					viewWithPreview.previewMode.rerender(true);
				}
			}
		}
	}
}
