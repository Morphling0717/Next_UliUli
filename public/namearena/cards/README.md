# 名字大乱斗卡图槽位

所有卡图使用约 `1:1.458` 的竖版比例并以 WebP 提供。已有正式资源的卡会完整显示原始卡面；尚未提供的普通召唤物继续显示独立占位卡。

## 召唤物

- `summons/guardian-kuriboh.webp` - 护主栗子球
- `summons/zhongli.webp` - 钟离
- `summons/saber.webp` - Saber
- `summons/sam.webp` - 萨姆
- `summons/bahamut.webp` - 巴哈姆特
- `summons/emrakul.webp` - 伊莫库
- `summons/surtr.webp` - 史尔特尔
- `summons/svarog.webp` - 史瓦罗
- `summons/puppet-ting.webp` - 小汀(傀儡)
- `summons/blue-eyes-white-dragon.webp` - 青眼白龙
- `summons/blue-eyes-ultimate-dragon.webp` - 青眼究极龙
- `summons/winged-dragon-of-ra.webp` - 翼神龙
- `summons/exodia-the-forbidden-one.webp` - 黑暗大法师

## 封印组件

- `components/sealed-right-arm.webp` - 被封印者的右腕
- `components/sealed-left-arm.webp` - 被封印者的左腕
- `components/sealed-right-leg.webp` - 被封印者的右足
- `components/sealed-left-leg.webp` - 被封印者的左足
- `components/sealed-exodia.webp` - 被封印者本体

## 高级召唤演出资源

四只高级召唤物均拥有以下配套资源：

- `monster_cutin/<key>.webp` - 召唤仪式后半段的透明背景立绘
- `avatar/<key>.webp` - 战场单位头像与战斗记录单位条头像

已启用的 `<key>` 为 `blue-eyes-white-dragon`、`blue-eyes-ultimate-dragon`、`winged-dragon-of-ra` 和 `exodia-the-forbidden-one`。

## 本地动画预览

开发环境可打开 `/app?namearenaSummonPreview=blue-eyes`、`ultimate`、`ra` 或 `exodia`，再开始任意一场战斗。对应召唤仪式会独立于普通战斗动画播放，便于逐张检查卡图与动画时序；生产构建会禁用该预览入口。
