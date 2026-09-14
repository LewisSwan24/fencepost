import styles from "./Shot.module.css";

// 一帧夜间画面。有图就铺图，没有就是夜色——两种情况下高度和圆角一样，
// 所以图片到位前后版面不会跳。
//
// 有东西压在画面上时（children），底下铺一层自下而上的暗罩：没有这层，总会有某张图
// 恰好在那个位置是亮的，字当场看不清。所以它跟着 children 走，不是永远都铺——
// 空铺一层的结果只是把每张照片白白压暗一次。
//
// 素材放 web/public/frames/。两条硬要求来自 CLAUDE.md 的安全底线：
//   上传前剥掉 EXIF/GPS——照片里带着拍摄地点，而这个产品讲的正是别暴露住址；
//   人脸和车牌必须遮挡。
// 剥 EXIF 得在放进来之前做，浏览器不会替你做。
// radius 取 md | lg | none。"none" 给列表卡片用：卡片自己是圆角加 overflow:hidden，
// 图再圆一次就在卡片的弧线里套出第二道弧线。
export default function Shot({ src, alt, height = 170, radius = "md", graded = false, children }) {
  return (
    <div
      className={[styles.shot, styles[radius] || styles.md].join(" ")}
      style={{ height }}
    >
      {src ? (
        // 没给 alt 就当装饰图，读屏器会跳过——比念一串文件名好。
        <img className={[styles.img, graded ? styles.graded : ""].join(" ")}
             src={src} alt={alt || ""} loading="lazy" />
      ) : null}
      {/* 暗罩只在真有东西压在画面上时才铺。它是为了让那些文字读得清，不是装饰；
          没有 children 还铺一层，就是白白把每张照片压暗一次。 */}
      {children ? <span className={styles.scrim} aria-hidden="true" /> : null}
      {children}
    </div>
  );
}
