# 北影节排片可视化

一个本地静态页面，把 `第十六届北京国际电影节“北京展映”排片表.xlsx` 渲染成电影 app 风格的浏览体验。

## 打开方式

推荐在项目根目录启动一个静态服务：

```bash
python3 -m http.server 8008
```

然后在浏览器里打开 `http://127.0.0.1:8008`。

## 重新生成数据

把排片 Excel 放到项目根目录，默认文件名为 `bjiff_schedule.xlsx`，然后运行：

```bash
python3 scripts/generate_bjiff_data.py
```

如果 Excel 文件名或位置不同，也可以显式传入：

```bash
python3 scripts/generate_bjiff_data.py /path/to/your-schedule.xlsx
```

脚本会覆盖生成最新的 `data.js`。

## 封面策略

- 优先尝试从 Wikipedia / Wikidata 查找公开封面或剧照
- 查不到时自动回退为文字海报
- 页面本身不依赖打包工具
