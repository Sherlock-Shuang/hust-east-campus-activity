import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../../app/store/useAppStore";
import { storyLocation } from "../../config/storyMedia";
import "./campus-location.css";

export function LocationPage() {
  const navigate = useNavigate();
  const session = useAppStore((state) => state.session);
  const completeLocationReveal = useAppStore((state) => state.completeLocationReveal);

  useEffect(() => {
    if (session.stage !== "location_reveal") navigate("/chat", { replace: true });
  }, [navigate, session.stage]);

  return (
    <main className="location-screen campus-location-screen">
      <section className="location-shell">
        <header className="location-heading"><p>位置共享</p><h1>TA 发来的位置</h1></header>
        <div className="location-card">
          <section className="campus-location-card" aria-label="华科光电大楼定位图">
            <div className="campus-location-map">
              <img src={storyLocation.mapUrl} alt="华中科技大学光电信息大楼及湖溪路周边地图" />
              <div className="campus-location-marker" aria-hidden="true">
                <span className="campus-location-label">{storyLocation.name}</span>
                <span className="campus-location-pin"><i /></span>
                <span className="campus-location-dot" />
              </div>
              <span className="campus-location-north" aria-hidden="true">↑<small>北</small></span>
              <a className="campus-location-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>
            </div>
            <div className="campus-location-details">
              <div><h2>{storyLocation.name}</h2><p>{storyLocation.address}</p></div>
              <span className="campus-location-distance">距你 <strong>0.00</strong> 公里</span>
            </div>
          </section>
          <div className="location-actions">
            <button type="button" className="button-primary" onClick={() => {
              completeLocationReveal();
              navigate("/chat");
            }}>退出查看</button>
          </div>
        </div>
      </section>
    </main>
  );
}
