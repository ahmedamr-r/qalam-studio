// The desktop app's one bridge into the page: the system's own folder picker, to open a folder as
// an organization. Nothing else from Node or Electron reaches the page.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("qalamDesktop", {
  chooseFolder: (title) => ipcRenderer.invoke("qalam:choose-folder", String(title ?? "")),
});
