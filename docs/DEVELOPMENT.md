# 开发与打包

运行插件不需要额外安装 Node.js 或 Python。开发检查使用 Node.js，打包使用 Python 3.9 或更新版本。

```powershell
npm run check
npm test
python scripts/package.py
```

`dist` 输出安装包、ZIP、源码 ZIP、SHA-256 校验文件和包内清单。打包使用白名单，排除 tools/Everything、个人状态、索引和测试截图；不要直接压缩整个工作目录发布。

浏览器测试需 Chrome 与 Playwright，通过 `BRIDGE_PLAYWRIGHT` 指定模块路径，运行 tests 下对应的 `.check.cjs`。部分测试读取本机 Eagle 安装包；未配置 yauzl 时原生 ZIP 读取测试跳过。删除测试使用合成数据和模拟回收站。

保留 `assets/blender` 的 SVG、来源和许可证。Eagle 原生资源仅在运行时读取，不随本项目分发。
