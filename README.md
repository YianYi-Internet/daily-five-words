# 每日五词

一个面向 Android 的个人英语单词 PWA。每天 5 个单词，一年就是 1800。每天随机学习 5 个新词，下一次打开先复习最近一组，也可以从已经学会的词中随机复习。

## 已实现功能

- 每天随机抽取并锁定 5 个新词
- 从当前常用度区段随机抽词，避免整库随机导致难度失控
- 新词卡片先显示单词和词性，轻触后显示中文释义
- 新词选择“不认识”后，会在本组末尾再出现一次
- 下一次打开先复习最近完成的 5 个词
- 复习选择“不认识”时，该词从已学习词库回到未学习词库
- 复习失败的词进入优先重学区，最多在每次新词抽取中优先返回 2 个
- 随机复习使用洗牌队列，尽量让已学词逐个轮到
- 当天抽出的 5 个词会锁定，刷新页面不会重新抽取
- 未完成当前批次时，下次打开可以继续
- 学习状态保存在手机浏览器本地
- 支持离线打开和添加到 Android 桌面
- 不显示学习记录、连续天数或统计页面

## 本地运行

需要 Node.js 18 或更高版本：

```bash
node server.mjs
```

然后打开：

```text
http://localhost:4173
```

运行逻辑测试：

```bash
node --test tests/logic.test.mjs
```

## 使用流程

### 今日学习

1. 进入“今日学习”
2. 如果存在上一次完成的 5 个词，先复习它们
3. 系统锁定今天要学习的 5 个新词
4. 逐个查看单词、词性和中文释义
5. 选择“认识”或“不认识”
6. 完成后，这 5 个词进入已学习词库
7. 它们同时成为下一次打开时的复习批次

### 复习

- 复习中只有“不认识”会改变词库归属
- 不认识的词会从已学习词库移除，并重新回到未学习词池
- 这些词会被优先安排重新学习
- 重新学会以后，会再次进入已学习词库和下一次复习批次

### 随机复习

- 从已经学会的词中抽取 5 个
- 已学词不足 5 个时，有几个抽几个
- 随机复习失败的词同样回到未学习词库
- 当天新词和当前待复习批次不会同时出现在随机复习里

## 数据说明

主词库：

`data/words.json`

共 13,633 个单词或短语，每条只有三个字段：

```json
{
  "word": "accept",
  "partOfSpeech": "vt.; vi.",
  "meaning": "接受，承认，同意，相信；同意"
}
```

词性使用英文缩写；多词性使用分号连接；短语为 `phrase`；缩写为 `abbr.`；没有明确词性的词使用空字符串。

## 状态保存

应用不会修改 GitHub 上的 JSON 文件。学习状态保存在浏览器本地，包含：

- 当前锁定的 5 个词
- 最近一次完成、等待复习的 5 个词
- 已学习词库
- 复习失败、等待重新学习的词
- 随机复习的洗牌队列

清除浏览器数据会同时清除学习进度。这是无账号、无服务器方案的限制。

## GitHub Pages 发布

仓库已经包含：

`.github/workflows/deploy.yml`

推送到 GitHub 的 `main` 分支后：

1. 打开仓库的 `Settings → Pages`
2. 在 `Build and deployment` 中选择 `GitHub Actions`
3. 等待 Actions 完成部署
4. 在 Android Chrome 打开发布网址
5. 菜单中选择“安装应用”或“添加到主屏幕”

免费的 GitHub Pages 通常要求仓库公开。

## 目录结构

```text
daily-five-words/
├─ data/words.json
├─ icons/
├─ licenses/
├─ tests/logic.test.mjs
├─ .github/workflows/deploy.yml
├─ app.js
├─ logic.js
├─ index.html
├─ styles.css
├─ manifest.webmanifest
├─ sw.js
├─ server.mjs
└─ package.json
```

## 数据来源

词库整理自 GitHub 项目 `CD155/collins-vocabulary`，该项目使用 MIT 许可；原始数据来源于 `skywind3000/ECDICT`，同样使用 MIT 许可。许可原文位于 `licenses/collins-vocabulary-LICENSE.txt`。

