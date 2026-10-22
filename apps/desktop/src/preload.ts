import { contextBridge, ipcRenderer } from 'electron';
import type { DeviceInfo } from './device-info';

// The only API the page gets from the desktop shell.
contextBridge.exposeInMainWorld('device', {
  info: (): Promise<DeviceInfo> => ipcRenderer.invoke('device:info'),
});
