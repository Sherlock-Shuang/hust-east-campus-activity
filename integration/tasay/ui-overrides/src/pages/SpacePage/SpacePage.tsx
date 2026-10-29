import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../../app/store/useAppStore";
import { getSpacePosts } from "../../features/story/stageConfig";
import "./campus-moments.css";

const posts = [
  {
    id: "campus",
    author: "Sherlock",
    time: "今天 18:12",
    tag: "朋友动态",
    content: "支持你跨过 12 条消息之后，我有一种你终于肯认真说话的感觉。",
    images: [
      { id: "campus-1", alt: "蓝白色球衣", url: "https://picsum.photos/seed/overspec-lover-jersey/800/600" },
      { id: "campus-2", alt: "桌面与纸张", url: "https://picsum.photos/seed/overspec-lover-notes/800/600" },
      { id: "campus-3", alt: "日常晴天街景", url: "https://picsum.photos/seed/overspec-lover-sky/800/600" }
    ]
  },
  {
    id: "product",
    author: "新基础（浙大 pavzzle 邀请观察）",
    time: "今天 17:08",
    tag: "技术分享",
    content: "科技感这事你已经写进 6 年级作业了，朋友圈就该留一点这种亮白、清爽、像真的生活痕迹。",
    images: [
      { id: "product-1", alt: "技术分享现场", url: "https://picsum.photos/seed/overspec-lover-talk/800/600" },
      { id: "product-2", alt: "电脑与界面", url: "https://picsum.photos/seed/overspec-lover-ui/800/600" },
      { id: "product-3", alt: "城市夜景", url: "https://picsum.photos/seed/overspec-lover-night/800/600" }
    ]
  },
  {
    id: "trip",
    author: "刘健 知识产权",
    time: "今天 15:36",
    tag: "照片动态",
    content: "一直不明白的是，为什么有些风景看起来平静，回头再看却像在提醒你别装没看见。",
    images: [
      { id: "trip-1", alt: "山间公路", url: "https://picsum.photos/seed/overspec-lover-road/800/600" },
      { id: "trip-2", alt: "湖面风景", url: "https://picsum.photos/seed/overspec-lover-lake/800/600" },
      { id: "trip-3", alt: "观景栏杆", url: "https://picsum.photos/seed/overspec-lover-rail/800/600" },
      { id: "trip-4", alt: "山里云层", url: "https://picsum.photos/seed/overspec-lover-cloud/800/600" }
    ]
  }
] as const;

export function SpacePage() {
  const navigate = useNavigate();
  const session = useAppStore((state) => state.session);
  useEffect(() => {
    if (session.stage === "meta_break" || session.stage === "truth_reveal") navigate("/truth", {replace:true});
  }, [navigate, session.stage]);
  const anomalies = getSpacePosts(session.spaceVisitCount);
  const ownSpace = session.spaceVisitCount >= 2;

  return <main className="space-feed-screen campus-moments">
    <header className="space-mobile-topbar">
      <button type="button" onClick={() => navigate("/chat")} aria-label="返回聊天">
        <span className="campus-moments-back-chevron" aria-hidden="true" />返回
      </button>
      <span>朋友圈</span><span aria-hidden="true" />
    </header>
    <section className="space-feed-shell">
      <header className="space-cover-card">
        <div className="space-cover-image" aria-hidden="true" />
        <div className="space-cover-meta">
          <div className="campus-moments-cover-intro">
            <p className="space-cover-eyebrow">朋友圈</p>
            <h1 className="space-cover-title">{ownSpace ? "你的朋友圈" : "宝宝的朋友圈"}</h1>
            <p className="space-cover-subtitle">有些内容，看第二次会不一样。</p>
            <div className="space-cover-actions"><button type="button" className="button-primary" onClick={() => navigate("/chat")}>回到聊天</button></div>
          </div>
          <div className="space-profile-chip">
            <span className="space-profile-name">{ownSpace ? "我" : "宝宝"}</span>
            <span className="space-profile-avatar">{ownSpace ? "我" : "宝"}</span>
          </div>
        </div>
      </header>
      <div className="space-feed-layout">
        <aside className="space-sidebar-card">
          <p className="space-sidebar-label">刚刚更新</p>
          <div className="space-sidebar-stack">
            {anomalies.map((post,index) => <article key={post} className="space-alert-card">
              <span className="space-alert-index">0{index+1}</span>
              <header className="campus-moments-mobile-only campus-moments-update-heading">
                <span className={`space-feed-card-avatar ${ownSpace ? "campus-moments-notice-avatar" : "campus-moments-partner-avatar"}`} aria-hidden="true">{ownSpace ? "圈" : "宝"}</span>
                <strong>{ownSpace ? "朋友圈提示" : "宝宝"}</strong>
              </header>
              <p>{post}</p>
              <span className="campus-moments-mobile-only campus-moments-post-time">刚刚</span>
            </article>)}
          </div>
          <div className="space-sidebar-actions"><button type="button" className="button-primary" onClick={() => navigate("/chat")}>回到聊天</button></div>
        </aside>
        <section className="space-feed-main" aria-label="朋友动态">
          <div className="space-feed-list">
            {posts.map(post => <article key={post.id} className={`space-feed-card campus-moments-post-${post.id}`}>
              <header className="space-feed-card-header">
                <div className="space-feed-card-avatar" aria-hidden="true">{post.author.slice(0,1)}</div>
                <div className="space-feed-card-meta"><strong>{post.author}</strong><span>{post.tag} · {post.time}</span></div>
              </header>
              <p className="space-feed-card-copy">{post.content}</p>
              <div className={`space-feed-image-grid columns-${Math.min(post.images.length, 3)}`} style={{ width: "100%", maxWidth: 360, gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 4, marginTop: 11 }}>
                {post.images.map(image => <div key={image.id} className="space-feed-image-tile" style={{ minWidth: 0, aspectRatio: "1", borderRadius: 2 }}>
                  <img src={image.url} alt={image.alt} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>)}
              </div>
              <span className="campus-moments-mobile-only campus-moments-post-time">{post.time}</span>
            </article>)}
          </div>
        </section>
      </div>
    </section>
  </main>;
}
