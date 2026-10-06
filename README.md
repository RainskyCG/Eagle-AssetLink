# Eagle AssetLink

**本地资产浏览器 · v1.0.0**

把 Eagle 中的预览素材与磁盘上的源文件连接起来。在 Eagle 里找到本地资产、浏览同目录文件，并直接预览图片、PDF、视频和模型。

**适用环境：Windows / Eagle 4**

[下载安装包](https://github.com/RainskyCG/Eagle-AssetLink/releases/latest) · [使用说明](docs/INSTALL.md) · [反馈问题](https://github.com/RainskyCG/Eagle-AssetLink/issues)

## 可以做什么

| 功能 | 用法 |
| --- | --- |
| 找到本地源文件 | 选中 Eagle 素材，点击右侧「定位」 |
| 浏览资产目录 | 点击「展开」，在中央面板浏览、搜索、筛选和排序 |
| 关联多个搜索结果 | 在候选目录中点击「选择并关联」，记住对应关系 |
| 查看文件 | 打开中央顶栏右侧的预览栏，选择文件即可预览 |
| 浏览 ZIP | 下方查看压缩包目录，上方预览选中的内容 |
| 管理本地文件 | 右键打开、重命名、删除或新建文件夹，支持多选 |

图片支持滚轮缩放、拖动平移、双击复位。列表提供详细、水平和缩略图模式，配色跟随 Eagle 主题。

## 三步开始

### 1. 安装插件

下载 [最新版本](https://github.com/RainskyCG/Eagle-AssetLink/releases/latest)中的 `.eagleplugin` 文件，双击并在 Eagle 中确认安装。

也可下载 ZIP，解压后通过 Eagle「插件 → 开发者选项 → 导入本地项目」选择包含 `manifest.json` 的目录。

### 2. 配置搜索

从 Eagle 插件菜单打开 **Eagle AssetLink**：

- 配置 **Everything** 和 **es.exe** 的路径，点击检测并连接；缺少工具时可使用插件中的官方自动配置。
- 在 **资产库目录** 添加源资产所在目录。
- 等待 Everything 完成索引。NAS/网络目录还需加入 Everything 的文件夹索引。

**安装包不包含 Everything、ES、索引数据库或个人配置。** 也可以从 [voidtools 官网](https://www.voidtools.com/downloads/)自行下载。

### 3. 定位或展开

选中 Eagle 中的素材，在右侧点击 **定位** 或 **展开**。如果素材名称带有“预览图”“thumbnail”等后缀，可在设置的「定位规则」中添加忽略关键词。

没有找到本地资产时，插件会展示该素材在 Eagle 库内的文件列表，此列表只读。

## 常用操作

- **Ctrl / Shift + 单击**：增减选择 / 连续选择。
- **Ctrl + 滚轮**：切换列表及缩略图尺寸。
- **双击文件夹**：进入；双击文件的行为可在设置中选择。
- **右键删除**：确认后移入系统回收站，保留 Eagle 素材。
- **预览栏分隔线**：拖动调整宽度及上下区域大小。
- **返回 Eagle**：点击左上角返回图标；切换 Eagle 左侧目录也会退出中央面板。

更多按键、配置方法及常见问题见 [使用说明](docs/INSTALL.md)。

## 预览与兼容性

优先使用 Eagle 已启用的格式查看器插件，没有可用插件时尝试原生预览。部分格式只显示静态预览图；依赖真实 Eagle 资产 ID 的第三方查看器可能无法打开未导入的本地文件。

ZIP 普通图片单张上限 16 MB，其他预览条目上限 256 MB；仅按需读取，不执行包内文件。暂不支持加密 ZIP、RAR、7z。包内模型依赖的外部材质可能缺失。

中央面板使用 Eagle 内部接口，Eagle 升级后可能需要适配。当前不支持 macOS。

## 更新与数据

插件更新保留原设置与关联。旧名称 Eagle Bridge 的用户可直接升级；原插件 ID、数据目录与关联标签保持兼容。更换电脑后需要重新配置工具路径和资产目录。

[更新记录](CHANGELOG.md) · [第三方资源说明](THIRD_PARTY_NOTICES.md) · [开发与打包](docs/DEVELOPMENT.md)
