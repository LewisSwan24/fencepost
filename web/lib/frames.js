// 占位素材。**这些不是用户拍的**——是 Wikimedia Commons 上的 CC BY-SA 4.0 照片，
// 按物种配给时间线上的 entry，好让界面不是一排空矩形。
//
// 这一点必须在 /credits 页面上说清楚：真实的 Fencepost 里，这个位置放的是拍摄者自己的
// 视频截帧。拿别人的照片配着用户的故事而不声明，等于暗示「这就是他拍到的那只」。
//
// 处理过程：原图 2 到 8 MB，缩到 1200px、剥掉 EXIF/GPS/机型，重新编码。
// 剥元数据是 CLAUDE.md 的安全底线，不因为素材来自公开站点而免除——
// 照片里带着拍摄地点，而这个产品讲的正是别暴露住址。
//
// 调色：四张里只有一张是夜拍。`night: false` 的会被 CSS 压暗降饱和，因为整个产品
// 发生在傍晚到深夜。调过色就是衍生作品，CC BY-SA 要求标注，鸣谢页里标了。

export const FRAMES = [
  {
    slug: "ringtail-shorncliffe-night",
    file: "/frames/ringtail-shorncliffe-night.jpg",
    species: "ringtail",
    night: true,
    alt: "Two ringtail possums in the rafters of a park shelter at night",
    where: "Moora Park, Shorncliffe, Brisbane",
    author: "John Robert McPherson",
    licence: "CC BY-SA 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    source: "https://commons.wikimedia.org/wiki/File:Common_ringtail_possum_Moora_Park_Shorncliffe_P1110079.jpg",
  },
  {
    slug: "ringtail-brisbane",
    file: "/frames/ringtail-brisbane.jpg",
    species: "ringtail",
    night: false,
    alt: "A ringtail possum on the ground among fallen leaves, looking at the camera",
    where: "Brisbane",
    author: "Andrew Mercer",
    licence: "CC BY-SA 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    source: "https://commons.wikimedia.org/wiki/File:Common_Ringtail_Possum_-_AndrewMercer_IMG14110.jpg",
  },
  {
    slug: "ringtail-brisbane-park",
    file: "/frames/ringtail-brisbane-park.jpg",
    species: "ringtail",
    night: false,
    alt: "A ringtail possum climbing among thin branches, seen from below",
    where: "A park in Brisbane",
    author: "Andrew Mercer",
    licence: "CC BY-SA 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    source: "https://commons.wikimedia.org/wiki/File:Ringtail_Possum._Brisbane.jpg",
  },
  {
    slug: "brushtail-botanic-gardens",
    file: "/frames/brushtail-botanic-gardens.jpg",
    species: "brushtail",
    night: false,
    alt: "A brushtail possum on a tree branch, turned towards the camera",
    where: "City Botanic Gardens, Brisbane",
    author: "Andrew Mercer",
    licence: "CC BY-SA 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    source: "https://commons.wikimedia.org/wiki/File:Brushtail_Possum_-_AndrewMercer_IMG40144.jpg",
  },
];

// 同一条 entry 每次都要拿到同一张图，否则刷新一次画面就换了，看着像坏的。
// 所以用 id 算一个稳定的下标，不用随机。
function pick(list, seed) {
  let hash = 0;
  for (const ch of String(seed)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return list[hash % list.length];
}

export function frameForSpecies(species, seed) {
  const matching = FRAMES.filter((f) => f.species === species);
  // 物种是 other、unknown、或者一条 entry 都还没有时，不配图——硬塞一只负鼠进去，
  // 就是替用户断言他拍到了什么，而「视觉识别不得自动设定物种」正是这个项目的红线之一。
  if (!matching.length) return null;
  return pick(matching, seed);
}

export function frameFor(entry) {
  if (!entry) return null;
  return frameForSpecies(entry.species, entry.id);
}
