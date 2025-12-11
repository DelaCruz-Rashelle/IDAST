import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Link from "next/link";

export default function About() {
  const router = useRouter();
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
        <title>About — Barangay Hidalgo Solar Tracker</title>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="description" content="IDAST-ESP: Intelligent Dual-Axis Solar Tracker for Barangay Hidalgo, Tanauan, Batangas" />
      </Head>
      
      {/* Header Navigation */}
      <header className={`header-nav ${isScrolled ? "scrolled" : ""}`}>
        <div className="nav-container">
          <div className="nav-brand">
            <div className="sun-icon"></div>
            <span className="brand-text">Solar Tracker</span>
          </div>
          <nav className="nav-menu">
            <Link href="/about" className="nav-link active">About Us</Link>
            <Link href="/contact" className="nav-link">Contact</Link>
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

      {/* Hero Section */}
      <section className="hero-section">
        <div className="hero-content">
          <div className="hero-sun"></div>
          <h1 className="hero-title">IDAST-ESP</h1>
          <p className="hero-subtitle">Intelligent Dual-Axis Solar Tracker</p>
          <p className="hero-location">Barangay Hidalgo, Tanauan, Batangas</p>
        </div>
      </section>

      {/* About Section */}
      <section className="about-section">
        <div className="container">
          <div className="section-header">
            <h2 className="section-title">About the Project</h2>
            <div className="title-underline"></div>
          </div>
          
          <div className="about-content">
            <p className="about-text">
              This study presents <strong>IDAST-ESP</strong>, an Intelligent Dual-Axis Solar Tracker designed to enhance the efficiency of solar energy harvesting through automated sunlight tracking and IoT integration. The system utilizes an ESP32 microcontroller equipped with advanced sensors to continuously detect and follow the sun's position throughout the day, maximizing the amount of energy captured by the solar panel.
            </p>
            
            <p className="about-text">
              By enabling movement along both horizontal and vertical axes, the tracker ensures optimal alignment with sunlight, reducing energy loss caused by static installations. The system also features an IoT-based monitoring interface, allowing users to remotely observe real-time data on panel orientation, voltage, and environmental conditions.
            </p>
            
            <p className="about-text">
              Built using Arduino IDE and integrated with Wi-Fi communication, the prototype demonstrates the potential of combining smart automation and renewable energy technologies. The implementation of IDAST-ESP provides an innovative approach to sustainable energy systems and serves as a foundation for future developments in intelligent solar tracking solutions.
            </p>
          </div>

          {/* Features Grid */}
          <div className="features-grid">
            <div className="feature-card">
              <div className="feature-icon">🌞</div>
              <h3 className="feature-title">Dual-Axis Tracking</h3>
              <p className="feature-desc">Automated horizontal and vertical movement for optimal sun alignment</p>
            </div>
            
            <div className="feature-card">
              <div className="feature-icon">📡</div>
              <h3 className="feature-title">IoT Integration</h3>
              <p className="feature-desc">Real-time remote monitoring via Wi-Fi connectivity</p>
            </div>
            
            <div className="feature-card">
              <div className="feature-icon">⚡</div>
              <h3 className="feature-title">Energy Efficiency</h3>
              <p className="feature-desc">Maximizes solar energy capture through intelligent tracking</p>
            </div>
            
            <div className="feature-card">
              <div className="feature-icon">📊</div>
              <h3 className="feature-title">Real-Time Data</h3>
              <p className="feature-desc">Monitor panel orientation, voltage, and environmental conditions</p>
            </div>
            
            <div className="feature-card">
              <div className="feature-icon">🔧</div>
              <h3 className="feature-title">ESP32 Powered</h3>
              <p className="feature-desc">Advanced microcontroller with sensor integration</p>
            </div>
            
            <div className="feature-card">
              <div className="feature-icon">🌱</div>
              <h3 className="feature-title">Sustainable</h3>
              <p className="feature-desc">Innovative approach to renewable energy systems</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="cta-section">
        <div className="container">
          <div className="cta-content">
            <h2 className="cta-title">Ready to Monitor?</h2>
            <p className="cta-text">Access the dashboard to view real-time solar tracking data</p>
            <Link href="/login" className="cta-button">
              Access Dashboard
            </Link>
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

        /* Header Navigation */
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

        /* Hero Section */
        .hero-section {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 120px 20px 80px;
          position: relative;
        }

        .hero-content {
          max-width: 800px;
        }

        .hero-sun {
          width: 80px;
          height: 80px;
          background: linear-gradient(180deg, #ffd24d, #ff9a3c);
          border-radius: 50%;
          box-shadow: 0 0 60px #ffb347a0;
          margin: 0 auto 32px;
          animation: pulse 3s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.1); opacity: 0.9; }
        }

        .hero-title {
          font-size: 64px;
          font-weight: 700;
          margin-bottom: 16px;
          background: linear-gradient(180deg, #e6f0ff, #9fb3d1);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .hero-subtitle {
          font-size: 28px;
          color: var(--muted);
          margin-bottom: 12px;
          font-weight: 600;
        }

        .hero-location {
          font-size: 16px;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.4px;
        }

        /* About Section */
        .about-section {
          padding: 100px 0;
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

        .title-underline {
          width: 80px;
          height: 4px;
          background: linear-gradient(90deg, transparent, var(--accent), transparent);
          margin: 0 auto;
          border-radius: 2px;
        }

        .about-content {
          max-width: 900px;
          margin: 0 auto 80px;
        }

        .about-text {
          font-size: 18px;
          line-height: 1.8;
          margin-bottom: 24px;
          color: var(--ink);
        }

        .about-text strong {
          color: var(--accent);
          font-weight: 700;
        }

        /* Features Grid */
        .features-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 24px;
          margin-top: 60px;
        }

        .feature-card {
          background: linear-gradient(180deg, #101734, #0d142b);
          border: 1px solid var(--grid);
          border-radius: 14px;
          padding: 32px;
          text-align: center;
          transition: all 0.3s ease;
        }

        .feature-card:hover {
          transform: translateY(-4px);
          border-color: var(--accent);
          box-shadow: 0 8px 30px rgba(47, 210, 122, 0.2);
        }

        .feature-icon {
          font-size: 48px;
          margin-bottom: 16px;
        }

        .feature-title {
          font-size: 20px;
          font-weight: 700;
          margin-bottom: 12px;
          color: var(--accent);
        }

        .feature-desc {
          font-size: 14px;
          color: var(--muted);
          line-height: 1.6;
        }

        /* CTA Section */
        .cta-section {
          padding: 100px 0;
          background: linear-gradient(180deg, transparent, rgba(47, 210, 122, 0.05));
        }

        .cta-content {
          text-align: center;
          max-width: 600px;
          margin: 0 auto;
        }

        .cta-title {
          font-size: 36px;
          font-weight: 700;
          margin-bottom: 16px;
        }

        .cta-text {
          font-size: 18px;
          color: var(--muted);
          margin-bottom: 32px;
        }

        .cta-button {
          display: inline-block;
          padding: 16px 40px;
          background: linear-gradient(180deg, #2fd27a, #11a85a);
          color: #09151a;
          text-decoration: none;
          border-radius: 8px;
          font-weight: 700;
          font-size: 16px;
          transition: all 0.3s;
        }

        .cta-button:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 20px rgba(47, 210, 122, 0.4);
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
          .hero-title {
            font-size: 42px;
          }

          .hero-subtitle {
            font-size: 20px;
          }

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

          .about-text {
            font-size: 16px;
          }

          .features-grid {
            grid-template-columns: 1fr;
          }

          .cta-title {
            font-size: 28px;
          }
        }

        @media (max-width: 480px) {
          .hero-title {
            font-size: 32px;
          }

          .hero-subtitle {
            font-size: 18px;
          }

          .nav-container {
            padding: 12px 16px;
          }

          .brand-text {
            font-size: 16px;
          }
        }
      `}</style>
    </>
  );
}
