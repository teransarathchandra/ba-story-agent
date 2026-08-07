"use strict";
const electron = require("electron");
const api = {
  project: {
    list: () => electron.ipcRenderer.invoke("project:list"),
    create: (data) => electron.ipcRenderer.invoke("project:create", data),
    get: (id) => electron.ipcRenderer.invoke("project:get", id),
    status: (id) => electron.ipcRenderer.invoke("project:status", id)
  },
  session: {
    list: (projectId) => electron.ipcRenderer.invoke("session:list", projectId),
    add: (data) => electron.ipcRenderer.invoke("session:add", data),
    analyze: (data) => electron.ipcRenderer.invoke("session:analyze", data)
  },
  requirement: {
    list: (projectId) => electron.ipcRenderer.invoke("requirement:list", projectId),
    approve: (data) => electron.ipcRenderer.invoke("requirement:approve", data),
    reject: (data) => electron.ipcRenderer.invoke("requirement:reject", data)
  },
  assumption: {
    list: (projectId) => electron.ipcRenderer.invoke("assumption:list", projectId),
    promote: (data) => electron.ipcRenderer.invoke("assumption:promote", data)
  },
  question: {
    list: (projectId) => electron.ipcRenderer.invoke("question:list", projectId),
    updateStatus: (data) => electron.ipcRenderer.invoke("question:update-status", data)
  },
  recommendation: {
    list: (projectId) => electron.ipcRenderer.invoke("recommendation:list", projectId),
    accept: (data) => electron.ipcRenderer.invoke("recommendation:accept", data),
    decline: (data) => electron.ipcRenderer.invoke("recommendation:decline", data)
  },
  claim: {
    get: (id) => electron.ipcRenderer.invoke("claim:get", id)
  },
  story: {
    list: (projectId) => electron.ipcRenderer.invoke("story:list", projectId)
  },
  export: {
    project: (data) => electron.ipcRenderer.invoke("export:project", data)
  },
  onProgress: (callback) => {
    electron.ipcRenderer.on("analyze:progress", (_event, value) => callback(value));
    return () => electron.ipcRenderer.removeAllListeners("analyze:progress");
  }
};
if (process.contextIsolated) {
  try {
    electron.contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error(error);
  }
} else {
  window.api = api;
}
