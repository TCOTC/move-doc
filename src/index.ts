import {
    Plugin,
    Menu,
    fetchPost,
    fetchSyncPost,
    Wnd,
    Layout,
    Tab
} from "siyuan";
import "./index.scss";

export default class PluginSample extends Plugin {
    onload() {
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
        // console.log('type:', type);
        // console.log('menu:', menu);
        // console.log('elements:', elements);
        // console.log('getAllEditor():', getAllEditor());
        // console.log('getAllModels():', getAllModels());

        const currentDocParams = this.getCurrentDocParams();
        if (!currentDocParams) return;
        // const currentDocId = this.getCurrentDocId();
        // if (!currentDocId) return;

        // doc: 单个文档
        // docs: 多个文档 / 文档与笔记本混合
        // notebook: 单个笔记本
        if (type === "doc") {
            const targetDocId = elements[0]?.getAttribute('data-node-id');
            if (!targetDocId || currentDocParams.path.slice(-48).includes(targetDocId)) return; // 排除当前文档和父文档
            menu.addItem({
                id: "move-doc_to-this-doc",
                label: this.i18n.moveToThisDoc,
                click: async () => {
                    const res = await fetchSyncPost('/api/filetree/getPathByID', { id: targetDocId });
                    const targetDocNotebookId = res.data.notebook;
                    const targetDocPath = res.data.path;
                    if (!targetDocNotebookId || !targetDocPath) return;

                    // console.log('fromPaths:', currentDocParams.path);
                    // console.log('toNotebook:', targetDocNotebookId);
                    // console.log('toPath:', targetDocPath);

                    fetchPost('/api/filetree/moveDocs', {
                        fromPaths: [currentDocParams.path],
                        toNotebook: targetDocNotebookId,
                        toPath: targetDocPath,
                    });
                }
            });
            // if (!docId || docId === currentDocId) return;
            // menu.addItem({
            //     id: "move-doc_to-this-doc",
            //     label: this.i18n.moveToThisDoc,
            //     click: () => {
            //         fetchPost('/api/filetree/moveDocsByID', {
            //             fromIDs: [currentDocId],
            //             toID: docId,
            //         });
            //     }
            // });
        } else if (type === "notebook") {
            const notebookId = elements[0]?.parentElement?.getAttribute('data-url');
            if (!notebookId || (currentDocParams.notebookId === notebookId && currentDocParams.path.length <= 26)) return; // 如果文档在笔记本根目录的话需要排除当前笔记本
            menu.addItem({
                id: "move-doc_to-this-notebook",
                label: this.i18n.moveToThisNotebook,
                click: async () => {
                    // TODO跟进: '/api/filetree/moveDocsByID' 还不支持传递笔记本 ID https://github.com/siyuan-note/siyuan/issues/15616
                    // const res = await fetchSyncPost('/api/filetree/getPathByID', { id: currentDocId });
                    // const docPath = res.data.path;
                    const docPath = currentDocParams.path;
                    if (!docPath) return;
                    fetchPost('/api/filetree/moveDocs', {
                        fromPaths: [docPath],
                        toNotebook: notebookId,
                        toPath: "/",
                    });
                }
            });
        }
    };

    // getCurrentDocId = () => {
    //     return "20250817231905-vh1t3zh";
    // };
    // TODO跟进: 原生函数获取当前文档 ID https://github.com/siyuan-note/siyuan/issues/15415
    getCurrentDocParams = (): { path: string, notebookId: string } | false => {
        let element = document.querySelector(".layout__wnd--active > .fn__flex > .layout-tab-bar > .item--focus") as HTMLElement;
        if (!element) {
            document.querySelectorAll("ul.layout-tab-bar > .item--focus").forEach((item: HTMLElement, index) => {
                if (index === 0) {
                    element = item;
                } else if (item.dataset.activetime > element.dataset.activetime) {
                    element = item;
                }
            });
        }

        if (element) {
            const tab = this.getInstanceById(element.getAttribute("data-id")) as Tab;
            // 页签有可能不是文档页签
            if (tab && tab.model && typeof tab.model === 'object' && 'editor' in tab.model) {
                const model = tab.model as any;
                if (model.editor && model.editor.protyle) {
                    return {
                        path: model.editor.protyle.path,
                        notebookId: model.editor.protyle.notebookId
                    };
                }
            }
        }
        return false;
    };

    // 原生方法，不保证未来一直兼容
    getInstanceById = (id: string, layout = window.siyuan.layout.centerLayout) => {
        const _getInstanceById = (item: Layout | Wnd, id: string) => {
            if (item.id === id) {
                return item;
            }
            if (!item.children) {
                return;
            }
            let ret: Tab | Layout | Wnd;
            for (let i = 0; i < item.children.length; i++) {
                ret = _getInstanceById(item.children[i] as Layout, id) as Tab;
                if (ret) {
                    return ret;
                }
            }
        };
        return _getInstanceById(layout, id);
    };
}