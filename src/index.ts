import {
    Plugin,
    Menu,
    fetchPost,
    getFrontend,
    getActiveEditor
} from "siyuan";
import "./index.scss";

export default class PluginSample extends Plugin {
    isMobile: boolean;

    async onload() {
        const frontEnd = getFrontend();
        this.isMobile = frontEnd === "mobile" || frontEnd === "browser-mobile";
        // "open-menu-doctree": {
        //     menu: subMenu,
        //     elements: NodeListOf<HTMLElement>,
        //     type: "doc" | "docs" | "notebook",
        // };
        this.eventBus.on('open-menu-doctree', this.openMenuDoctree);
    }

    // onLayoutReady() {
    // }

    onunload() {
        this.eventBus.off('open-menu-doctree', this.openMenuDoctree);
    }

    uninstall() {
        this.eventBus.off('open-menu-doctree', this.openMenuDoctree);
    }

    openMenuDoctree = (event: CustomEvent) => {
        const type = event.detail.type;
        const menu = event.detail.menu as Menu;
        const elements = event.detail.elements;

        const currentDoc = this.getCurrentDoc();
        if (!currentDoc) return;

        // doc: 单个文档；docs: 多个文档 / 文档与笔记本混合；notebook: 单个笔记本
        if (type === "doc") {
            const targetDocId = elements[0]?.getAttribute('data-node-id');
            if (!targetDocId || currentDoc.path.slice(-48).includes(targetDocId)) return; // 排除当前文档和父文档
            menu.addItem({
                id: "move-doc_to-this-doc",
                label: this.i18n.moveToThisDoc,
                click: () => {
                    fetchPost('/api/filetree/moveDocsByID', {
                        fromIDs: [currentDoc.id],
                        toID: targetDocId,
                    });
                }
            });
        } else if (type === "notebook") {
            const targetNotebookId = elements[0]?.parentElement?.getAttribute('data-url');
            if (!targetNotebookId || (currentDoc.notebookId === targetNotebookId && currentDoc.path.length <= 26)) return; // 如果文档在笔记本根目录的话需要排除当前笔记本
            menu.addItem({
                id: "move-doc_to-this-notebook",
                label: this.i18n.moveToThisNotebook,
                click: async () => {
                    // TODO跟进: '/api/filetree/moveDocsByID' 还不支持传递笔记本 ID https://github.com/siyuan-note/siyuan/issues/15616
                    const docPath = currentDoc.path;
                    if (!docPath) return;
                    fetchPost('/api/filetree/moveDocs', {
                        fromPaths: [docPath],
                        toNotebook: targetNotebookId,
                        toPath: "/",
                    });
                }
            });
        }
    };

    getCurrentDoc = (): { id: string, path: string, notebookId: string } | undefined => {
        // 原生函数获取当前文档 ID https://github.com/siyuan-note/siyuan/issues/15415
        const protyle = getActiveEditor(false).protyle;
        if (!protyle.block?.rootID || !protyle.path || !protyle.notebookId) return undefined;
        return {
            id: protyle.block.rootID,
            path: protyle.path,
            notebookId: protyle.notebookId
        };
    };
}