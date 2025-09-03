import {
    Plugin,
    Menu,
    Setting,
    fetchPost,
    fetchSyncPost,
    getActiveEditor,
    expandDocTree,
} from "siyuan";
import "./index.scss";

const STORAGE_NAME = "move-doc-config.json";

export default class PluginSample extends Plugin {
    public setting: Setting;

    async onload() {
        // "open-menu-doctree": {
        //     menu: subMenu,
        //     elements: NodeListOf<HTMLElement>,
        //     type: "doc" | "docs" | "notebook",
        // };
        this.eventBus.on('open-menu-doctree', this.openMenuDoctree);

        await this.loadData(STORAGE_NAME);
        this.data[STORAGE_NAME].expandDocTreeAfterMoveDoc ??= true;

        this.setting = new Setting({
            confirmCallback: () => {
                this.saveData(STORAGE_NAME, {expandDocTreeAfterMoveDoc: (document.getElementById("expandDocTreeAfterMoveDoc") as HTMLInputElement).checked});
            }
        });

        this.setting.addItem({
            // 移动文档之后展开文档树
            title: this.i18n.expandDocTreeAfterMoveDoc,
            direction: "column",
            createActionElement: () => {
                const input = document.createElement("input");
                input.type = "checkbox";
                input.classList.add("b3-switch", "fn__flex-center");
                input.id = "expandDocTreeAfterMoveDoc";
                input.checked = this.data[STORAGE_NAME].expandDocTreeAfterMoveDoc;
                return input;
            }
        });
    }

    onunload() {
        this.eventBus.off('open-menu-doctree', this.openMenuDoctree);
    }

    uninstall() {
        this.eventBus.off('open-menu-doctree', this.openMenuDoctree);
    }

    openMenuDoctree = (event: CustomEvent) => {
        const type = event.detail.type;
        const menu = event.detail.menu as Menu;
        const element = event.detail.elements[0];

        const currentDoc = this.getCurrentDoc();
        if (!currentDoc) {
            // 当前文档不存在
            return;
        };
        let targetId: string, boxID: string;

        // doc: 单个文档；docs: 多个文档 / 文档与笔记本混合；notebook: 单个笔记本
        if (type === "doc") {
            const targetDocId = element?.getAttribute('data-node-id');
            if (!targetDocId || currentDoc.path.slice(-48).includes(targetDocId)) {
                // 排除当前文档、父文档
                return;
            };
            targetId = targetDocId;
            boxID = currentDoc.notebookId;
            // TODO跟进: 目前不支持使用异步操作 https://github.com/siyuan-note/siyuan/issues/15676
            // const targetDocInfo = await fetchSyncPost("/api/block/getBlockInfo", { id: targetDocId });
            // if (!targetDocInfo?.data?.path || targetDocInfo.data.path.includes(currentDoc.id)) {
            //     // 排除子文档
            //     return;
            // };
            // TODO功能: 考虑在事件参数里传递路径信息，不需要耗时请求 https://github.com/siyuan-note/siyuan/pull/15620
            const targetDocPath = element?.getAttribute('data-path');
            if (!targetDocPath || targetDocPath.includes(currentDoc.id)) {
                // 排除子文档
                return;
            };
        } else if (type === "notebook") {
            const targetNotebookId = element?.parentElement?.getAttribute('data-url');
            if (!targetNotebookId || (currentDoc.notebookId === targetNotebookId && currentDoc.path.length <= 26)) {
                // 如果文档在笔记本根目录的话需要排除当前笔记本
                return;
            };
            targetId = targetNotebookId;
            boxID = targetNotebookId;
        } else {
            // 不支持其他类型
            return;
        }

        menu.addItem({
            id: `move-doc_to-this-${type.toLowerCase()}`,
            icon: "iconMove",
            label: this.i18n[`moveToThis${type.charAt(0).toUpperCase() + type.slice(1).toLowerCase()}`],
            click: async () => {
                await fetchSyncPost('/api/filetree/moveDocsByID', {
                    fromIDs: [currentDoc.id],
                    toID: targetId,
                });
                // 等待文档移动完成之后才能展开文档树
                await new Promise(resolve => setTimeout(resolve, 512));

                // // TODO跟进: 没效果 https://github.com/siyuan-note/siyuan/issues/15617#issuecomment-3220161780
                // const wait = await fetchSyncPost("/api/sqlite/flushTransaction");
                // // console.log("wait", wait);

                // // await new Promise(resolve => setTimeout(resolve, 1000));

                let sortJson = await this.getFile(`/data/${boxID}/.siyuan/sort.json`);
                // 解析 json，结构是 `{"20250814155701-4i5l68u":10,"20250822181321-ateqaxg":8}`，把 currentDoc.id 加到里面，并且索引值要比最低的那个 -1
                // 解析 sortJson，如果为空则初始化为一个对象
                let sortObj: Record<string, number>;
                try {
                    sortObj = typeof sortJson === "string" ? JSON.parse(sortJson) : (sortJson || {});
                } catch (e) {
                    // 如果解析失败，则初始化为空对象
                    sortObj = {};
                }

                // 获取当前所有索引的最小值
                let minIndex = 0;
                const values = Object.values(sortObj);
                if (values.length > 0) {
                    minIndex = Math.min(...values);
                }
                // 将 currentDoc.id 加入对象，索引值为 minIndex - 1
                sortObj[currentDoc.id] = minIndex - 1;
                // sortObj[currentDoc.id] = 100;

                // 赋值回 sortJson
                sortJson = sortObj;
                // console.log("sortJson", sortJson);
                // console.log("/data/${boxID}/.siyuan/sort.json", `/data/${boxID}/.siyuan/sort.json`);
                const response = await this.putFile(`/data/${boxID}/.siyuan/sort.json`, sortJson);
                // const response2 = await this.putFile(`/data/${boxID}/.siyuan/sort2.json`, sortJson);
                console.log("response", response);
                // console.log("response2", response2);

                if (this.data[STORAGE_NAME].expandDocTreeAfterMoveDoc) {
                    // 移动文档之后展开文档树 https://github.com/TCOTC/move-doc/issues/2
                    expandDocTree({ id: currentDoc.id });
                }
            }
        });
    };

    getCurrentDoc = (): { id: string, path: string, notebookId: string } | null => {
        // 原生函数获取当前文档 protyle https://github.com/siyuan-note/siyuan/issues/15415
        const editor = getActiveEditor(false);
        const protyle = editor?.protyle;
        if (!protyle || !protyle.block?.rootID || !protyle.path || !protyle.notebookId) return null;
        return {
            id: protyle.block.rootID,
            path: protyle.path,
            notebookId: protyle.notebookId
        };
    };

    getFile(path: string): Promise<any> {
        let data = {
            path: path
        }
        return new Promise((resolve, _) => {
            fetchPost("/api/file/getFile", data, (content: any) => {
                resolve(content)
            });
        });
    }

    async putFile(path: string, json: any, isDir = false, modTime = Date.now()) {
        let file;
        if (typeof json === "object") {
            file = new File(
                [new Blob([JSON.stringify(json)], { type: "application/json" })],
                path.split("/").pop()
            );
        } else {
            file = new File([new Blob([json])], path.split("/").pop());
        }

        let formdata = new FormData();
        formdata.append("path", path);
        formdata.append("file", file);
        formdata.append("isDir", isDir.toString());
        formdata.append("modTime", modTime.toString());

        const response = await fetch("/api/file/putFile", {
            body: formdata,
            method: "POST",
        });

        if (response.ok)
            return await response.json();
        else
            return null;
    }
}