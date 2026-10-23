import { ListItemNode } from "@lexical/list";
import { $getNodeByKey, type EditorConfig, type LexicalEditor } from "lexical";
const domEditors = new WeakMap<HTMLElement, LexicalEditor>();

/** Keep list semantics on the LI and checkbox semantics on a native input. */
export class AccessibleListItemNode extends ListItemNode {
  $config() { return this.config("accessible-listitem", { extends: ListItemNode }); }

  createDOM(config: EditorConfig, editor?: LexicalEditor): HTMLElement {
    const element = super.createDOM(config);
    if (editor) domEditors.set(element, editor);
    const content = document.createElement("span");
    content.dataset.listItemContent = "";
    element.append(content);
    this.updateCheckbox(element, editor);
    return element;
  }
  getDOMSlot(element: HTMLElement) {
    return super.getDOMSlot(element.querySelector<HTMLElement>(":scope > [data-list-item-content]")!);
  }
  updateDOM(prev: ListItemNode, element: HTMLElement, config: EditorConfig) {
    super.updateDOM(prev, element, config);
    this.updateCheckbox(element, domEditors.get(element));
    return false;
  }
  private updateCheckbox(element: HTMLElement, editor?: LexicalEditor) {
    element.removeAttribute("role");
    element.removeAttribute("aria-checked");
    element.removeAttribute("tabindex");
    const checked = this.getChecked();
    let checkbox = element.querySelector<HTMLInputElement>(":scope > input[type=checkbox]");
    if (checked === undefined) { checkbox?.remove(); element.classList.remove("document-editor-check-item"); return; }
    element.classList.add("document-editor-check-item");
    if (!checkbox && editor) {
      const key = this.getKey();
      checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.contentEditable = "false";
      checkbox.setAttribute("aria-label", "완료 상태");
      checkbox.addEventListener("click", (event) => event.stopPropagation());
      checkbox.addEventListener("keydown", (event) => event.stopPropagation());
      checkbox.addEventListener("change", () => editor.update(() => {
        const node = $getNodeByKey(key);
        if (node instanceof ListItemNode) node.toggleChecked();
      }));
      element.prepend(checkbox);
    }
    if (checkbox) checkbox.checked = checked;
  }
}

export const accessibleListItemNodes = [AccessibleListItemNode, {
  replace: ListItemNode,
  with: (node: ListItemNode) => new AccessibleListItemNode(node.getValue(), node.getChecked()),
  withKlass: AccessibleListItemNode,
}];
