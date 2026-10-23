import type { ComponentType } from "react";
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalSpaceAround, AlignJustify,
  AlignStartHorizontal, AlignStartVertical, AlignVerticalSpaceAround, ArrowDown, ArrowUp, Bold, BringToFront, Circle,
  ClipboardPaste, Columns3, Component, Copy, CopyPlus, Download, Eye, FileJson, FlipHorizontal2, FlipVertical2, FolderOpen,
  Frame, Grid3x3, Group, Hand, Image, Italic, Keyboard, LayoutGrid, List, ListOrdered, Lock, Magnet, Maximize, Minus, Monitor,
  Moon, MousePointer2, MousePointerClick, MoveUpRight, Paintbrush, PanelLeft, PanelsTopLeft, PenTool, Pencil, Pentagon,
  Pipette, Redo2, Rows3, Ruler, Save, Scaling, Scan, ScanSearch, Scissors, SendToBack, Shrink, Spline, Square, SquareDashed,
  Star, Strikethrough, Sun, TextCursorInput, Trash2, Type, Underline, Undo2, Ungroup, ZoomIn, ZoomOut, Droplet, ArrowRightToLine, Network,
  type LucideProps,
} from "lucide-react";
import type { CommandCategory } from "@/commands";

/*
 * Palette row icons (16px, 1.25px strokes). Commands carry no icon of their own, so they are looked
 * up here by id, then by category. Qalam AI rows use the AI glyph instead (see CommandPalette).
 */

type Icon = ComponentType<LucideProps>;

const BY_ID: Record<string, Icon> = {
  "tool.select": MousePointer2, "tool.hand": Hand, "tool.scale": Scaling, "tool.frame": Frame, "tool.rect": Square,
  "tool.line": Minus, "tool.arrow": MoveUpRight, "tool.ellipse": Circle, "tool.polygon": Pentagon, "tool.star": Star,
  "tool.pen": PenTool, "tool.pencil": Pencil, "tool.text": Type, "tool.place-image": Image, "tool.eyedropper": Pipette,
  "tool.resources": LayoutGrid, "tool.focus-toolbar": Keyboard,
  "view.toggle-ui": PanelsTopLeft, "view.rulers": Ruler, "view.outlines": SquareDashed, "view.pixel-preview": Scan,
  "view.pixel-grid": Grid3x3, "view.snap-pixels": Magnet, "view.layout-grids": Columns3, "view.agent-cursors": MousePointer2,
  "view.minimize-ui": PanelLeft, "view.theme-dark": Moon, "view.theme-light": Sun, "view.theme-system": Monitor, "view.theme-toggle": Sun,
  "zoom.in": ZoomIn, "zoom.out": ZoomOut, "zoom.100": ScanSearch, "zoom.fit": Maximize, "zoom.selection": Scan,
  "zoom.next-frame": ArrowRightToLine, "zoom.prev-frame": ArrowRightToLine, "zoom.next-frame-pan": ArrowRightToLine, "zoom.prev-frame-pan": ArrowRightToLine,
  "edit.undo": Undo2, "edit.redo": Redo2, "edit.copy": Copy, "edit.cut": Scissors, "edit.paste": ClipboardPaste,
  "edit.paste-over": ClipboardPaste, "edit.paste-replace": ClipboardPaste, "edit.duplicate": CopyPlus, "edit.delete": Trash2,
  "edit.copy-png": Copy, "edit.copy-properties": Paintbrush, "edit.paste-properties": Paintbrush, "edit.rename": TextCursorInput,
  "edit.export": Download, "edit.save": Save,
  "transform.flip-h": FlipHorizontal2, "transform.flip-v": FlipVertical2,
  "arrange.bring-front": BringToFront, "arrange.send-back": SendToBack, "arrange.bring-forward": ArrowUp, "arrange.send-backward": ArrowDown,
  "arrange.align-left": AlignStartVertical, "arrange.align-right": AlignEndVertical, "arrange.align-top": AlignStartHorizontal,
  "arrange.align-bottom": AlignEndHorizontal, "arrange.align-hcenter": AlignCenterVertical, "arrange.align-vcenter": AlignCenterHorizontal,
  "arrange.distribute-h": AlignHorizontalSpaceAround, "arrange.distribute-v": AlignVerticalSpaceAround, "arrange.tidy-up": LayoutGrid,
  "arrange.group": Group, "arrange.ungroup": Ungroup, "arrange.frame-selection": Frame, "arrange.hide": Eye, "arrange.lock": Lock,
  "arrange.resize-to-fit": Shrink,
  "text.bold": Bold, "text.italic": Italic, "text.underline": Underline, "text.strikethrough": Strikethrough,
  "text.align-justify": AlignJustify, "text.bulleted-list": List, "text.numbered-list": ListOrdered,
  "file.open": FolderOpen, "file.export-json": FileJson,
};

const BY_CATEGORY: Partial<Record<CommandCategory, Icon>> = {
  tools: MousePointer2, view: Eye, panels: PanelLeft, zoom: ZoomIn, text: Type, shape: Droplet, vector: Spline,
  selection: MousePointerClick, cursor: MousePointer2, edit: Copy, transform: FlipHorizontal2, arrange: BringToFront,
  "auto-layout": Rows3, components: Component, file: FileJson, essential: Keyboard, discovery: Network,
};

export function CommandIcon({ id, category }: { id: string; category: CommandCategory }) {
  const I = BY_ID[id] ?? BY_CATEGORY[category] ?? Keyboard;
  return <I size={16} absoluteStrokeWidth strokeWidth={1.25} aria-hidden className="shrink-0" />;
}

/** Category names as tabs and palette sub-labels show them. */
export const CATEGORY_LABEL: Record<CommandCategory, string> = {
  essential: "Essential", tools: "Tools", view: "View", panels: "Panels", zoom: "Zoom", text: "Text", shape: "Shape",
  vector: "Vector", selection: "Selection", cursor: "Cursor", edit: "Edit", transform: "Transform", arrange: "Arrange",
  "auto-layout": "Auto layout", components: "Components", ai: "Qalam AI", file: "File", discovery: "Discovery",
};
