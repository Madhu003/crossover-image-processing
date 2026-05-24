import { NavLink, Outlet } from "react-router-dom";
import "./Layout.css";

export default function Layout() {
  return (
    <div className="page">
      <header className="header">
        <div className="header__top">
          <h1>Aperture</h1>
          <nav className="nav" aria-label="Main">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                isActive ? "nav__link nav__link--active" : "nav__link"
              }
            >
              Single image
            </NavLink>
            <NavLink
              to="/bulk"
              className={({ isActive }) =>
                isActive ? "nav__link nav__link--active" : "nav__link"
              }
            >
              Bulk jobs
            </NavLink>
          </nav>
        </div>
        <p>Upload photos, apply filters, and track async bulk processing jobs.</p>
      </header>

      <Outlet />
    </div>
  );
}
