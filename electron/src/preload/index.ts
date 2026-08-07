import { contextBridge, ipcRenderer } from 'electron'

const api = {
  project: {
    list: () => ipcRenderer.invoke('project:list'),
    create: (data: any) => ipcRenderer.invoke('project:create', data),
    get: (id: string) => ipcRenderer.invoke('project:get', id),
    status: (id: string) => ipcRenderer.invoke('project:status', id),
  },
  session: {
    list: (projectId: string) => ipcRenderer.invoke('session:list', projectId),
    add: (data: any) => ipcRenderer.invoke('session:add', data),
    analyze: (data: any) => ipcRenderer.invoke('session:analyze', data),
  },
  requirement: {
    list: (projectId: string) => ipcRenderer.invoke('requirement:list', projectId),
    approve: (data: any) => ipcRenderer.invoke('requirement:approve', data),
    reject: (data: any) => ipcRenderer.invoke('requirement:reject', data),
  },
  assumption: {
    list: (projectId: string) => ipcRenderer.invoke('assumption:list', projectId),
    promote: (data: any) => ipcRenderer.invoke('assumption:promote', data),
  },
  question: {
    list: (projectId: string) => ipcRenderer.invoke('question:list', projectId),
    updateStatus: (data: any) => ipcRenderer.invoke('question:update-status', data),
  },
  recommendation: {
    list: (projectId: string) => ipcRenderer.invoke('recommendation:list', projectId),
    accept: (data: any) => ipcRenderer.invoke('recommendation:accept', data),
    decline: (data: any) => ipcRenderer.invoke('recommendation:decline', data),
  },
  claim: {
    get: (id: string) => ipcRenderer.invoke('claim:get', id),
  },
  story: {
    list: (projectId: string) => ipcRenderer.invoke('story:list', projectId),
  },
  export: {
    project: (data: any) => ipcRenderer.invoke('export:project', data),
  },
  onProgress: (callback: (progress: any) => void) => {
    ipcRenderer.on('analyze:progress', (_event, value) => callback(value))
    return () => ipcRenderer.removeAllListeners('analyze:progress')
  },
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.api = api
}
