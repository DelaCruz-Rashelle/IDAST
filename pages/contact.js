import { useState, useEffect } from "react";
import Head from "next/head";
import Link from "next/link";

export default function Contact() {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    if (typeof window !== "undefined") {
      window.addEventListener("scroll", handleScroll);
      return () => window.removeEventListener("scroll", handleScroll);
    }
  }, []);

  return (
    <>
      <Head>
        <title>Contact — Barangay Hidalgo Solar Tracker</title>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
      </Head>
      
      {/* Header Navigation */}
      <header className={`header-nav ${isScrolled ? "scrolled" : ""}`}>
        <div className="nav-container">
          <div className="nav-brand">
            <div className="sun-icon"></div>
            <span className="brand-text">Solar Tracker</span>
          </div>
          <nav className="nav-menu">
            <Link href="/about" className="nav-link">About Us</Link>
            <Link href="/contact" className="nav-link active">Contact</Link>
            <Link href="/login" className="nav-link login-link">Login</Link>
          </nav>
          <button className="mobile-menu-btn" onClick={() => {
            const menu = document.querySelector('.nav-menu');
            menu?.classList.toggle('mobile-open');
          }}>
            <span></span>
            <span></span>
            <span></span>
          </button>
        </div>
      </header>

      {/* Contact Section */}
      <section className="contact-section">
        <div className="container">
          <div className="section-header">
            <h1 className="section-title">Contact Us</h1>
            <div className="title-underline"></div>
            <p className="section-subtitle">Get in touch with Barangay Hidalgo</p>
          </div>

          <div className="contact-content">
            <div className="contact-info">
              <div className="info-card">
                <div className="info-icon">📍</div>
                <h3 className="info-title">Location</h3>
                <p className="info-text">Barangay Hidalgo</p>
                <p className="info-text">Tanauan, Batangas</p>
                <p className="info-text">Philippines</p>
              </div>

              <div className="info-card">
                <div className="info-icon">📧</div>
                <h3 className="info-title">Email</h3>
                <p className="info-text">admin@barangayhidalgo.gov.ph</p>
              </div>

              <div className="info-card">
                <div className="info-icon">🌐</div>
                <h3 className="info-title">Project</h3>
                <p className="info-text">IDAST-ESP</p>
                <p className="info-text">Intelligent Dual-Axis Solar Tracker</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="footer">
        <div className="container">
          <p className="footer-text">
            © 2024 Barangay Hidalgo, Tanauan, Batangas. All rights reserved.
          </p>
          <p className="footer-subtext">
            IDAST-ESP: Intelligent Dual-Axis Solar Tracker
          </p>
        </div>
      </footer>

      <style jsx global>{`
        :root {
          --bg: #0b1020;
          --card: #121a33;
          --ink: #e6f0ff;
          --muted: #9fb3d1;
          --accent: #2fd27a;
          --grid: #1b2547;
          --header-bg: rgba(11, 16, 32, 0.95);
        }

        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        body {
          font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
          background: radial-gradient(1200px 600px at 20% -10%, #18306400, #18306488), var(--bg);
          color: var(--ink);
          line-height: 1.6;
        }

        .container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 20px;
        }

        /* Header Navigation - Same as about page */
        .header-nav {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 1000;
          background: var(--header-bg);
          backdrop-filter: blur(10px);
          border-bottom: 1px solid transparent;
          transition: all 0.3s ease;
        }

        .header-nav.scrolled {
          background: rgba(11, 16, 32, 0.98);
          border-bottom-color: var(--grid);
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        }

        .nav-container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 16px 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .nav-brand {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .sun-icon {
          width: 20px;
          height: 20px;
          background: linear-gradient(180deg, #ffd24d, #ff9a3c);
          border-radius: 50%;
          box-shadow: 0 0 16px #ffb347a0;
        }

        .brand-text {
          font-weight: 700;
          font-size: 18px;
          letter-spacing: 0.2px;
        }

        .nav-menu {
          display: flex;
          align-items: center;
          gap: 32px;
        }

        .nav-link {
          color: var(--muted);
          text-decoration: none;
          font-size: 14px;
          font-weight: 500;
          transition: color 0.2s;
          position: relative;
        }

        .nav-link:hover {
          color: var(--ink);
        }

        .nav-link.active {
          color: var(--accent);
        }

        .nav-link.active::after {
          content: '';
          position: absolute;
          bottom: -4px;
          left: 0;
          right: 0;
          height: 2px;
          background: var(--accent);
          border-radius: 2px;
        }

        .login-link {
          padding: 8px 20px;
          background: linear-gradient(180deg, #2fd27a, #11a85a);
          color: #09151a;
          border-radius: 8px;
          font-weight: 700;
          border: none;
        }

        .login-link:hover {
          opacity: 0.9;
          color: #09151a;
        }

        .mobile-menu-btn {
          display: none;
          flex-direction: column;
          gap: 4px;
          background: transparent;
          border: none;
          cursor: pointer;
          padding: 8px;
        }

        .mobile-menu-btn span {
          width: 24px;
          height: 2px;
          background: var(--ink);
          border-radius: 2px;
          transition: all 0.3s;
        }

        /* Contact Section */
        .contact-section {
          padding: 120px 0 100px;
          min-height: 80vh;
        }

        .section-header {
          text-align: center;
          margin-bottom: 60px;
        }

        .section-title {
          font-size: 42px;
          font-weight: 700;
          margin-bottom: 16px;
        }

        .section-subtitle {
          font-size: 18px;
          color: var(--muted);
          margin-top: 12px;
        }

        .title-underline {
          width: 80px;
          height: 4px;
          background: linear-gradient(90deg, transparent, var(--accent), transparent);
          margin: 0 auto;
          border-radius: 2px;
        }

        .contact-content {
          max-width: 900px;
          margin: 0 auto;
        }

        .contact-info {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 32px;
        }

        .info-card {
          background: linear-gradient(180deg, #101734, #0d142b);
          border: 1px solid var(--grid);
          border-radius: 14px;
          padding: 40px 32px;
          text-align: center;
          transition: all 0.3s ease;
        }

        .info-card:hover {
          transform: translateY(-4px);
          border-color: var(--accent);
          box-shadow: 0 8px 30px rgba(47, 210, 122, 0.2);
        }

        .info-icon {
          font-size: 48px;
          margin-bottom: 20px;
        }

        .info-title {
          font-size: 20px;
          font-weight: 700;
          margin-bottom: 16px;
          color: var(--accent);
        }

        .info-text {
          font-size: 16px;
          color: var(--muted);
          line-height: 1.8;
          margin-bottom: 8px;
        }

        /* Footer */
        .footer {
          padding: 40px 0;
          border-top: 1px solid var(--grid);
          text-align: center;
        }

        .footer-text {
          font-size: 14px;
          color: var(--muted);
          margin-bottom: 8px;
        }

        .footer-subtext {
          font-size: 12px;
          color: var(--muted);
          opacity: 0.7;
        }

        /* Responsive Design */
        @media (max-width: 768px) {
          .nav-menu {
            position: fixed;
            top: 70px;
            left: 0;
            right: 0;
            background: var(--header-bg);
            backdrop-filter: blur(10px);
            flex-direction: column;
            padding: 20px;
            gap: 20px;
            border-bottom: 1px solid var(--grid);
            transform: translateY(-100%);
            opacity: 0;
            visibility: hidden;
            transition: all 0.3s ease;
          }

          .nav-menu.mobile-open {
            transform: translateY(0);
            opacity: 1;
            visibility: visible;
          }

          .mobile-menu-btn {
            display: flex;
          }

          .section-title {
            font-size: 32px;
          }

          .contact-info {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 480px) {
          .nav-container {
            padding: 12px 16px;
          }

          .brand-text {
            font-size: 16px;
          }

          .contact-section {
            padding: 100px 0 60px;
          }
        }
      `}</style>
    </>
  );
}
