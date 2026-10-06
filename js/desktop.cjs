'use strict';

// Keep the Electron adapter in a CommonJS module: Eagle's window preload wraps
// window.require, whereas inspector and CommonJS contexts use Node's loader.
async function trashLocal(target) {
  const shell = require('electron').shell;
  if (!shell?.trashItem) throw Error('当前 Eagle 环境不支持系统回收站，已停止删除');
  try { await shell.trashItem(target); }
  catch (error) {
    throw Error('本地目标未能移入回收站，已停止删除。网络共享可能不支持回收站；不会改为永久删除。\n'+error.message);
  }
}
module.exports = {trashLocal};
