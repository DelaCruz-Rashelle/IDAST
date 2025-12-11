import { useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  // Barangay Hidalgo, Tanauan, Batangas admin credentials
  const VALID_EMAIL = process.env.NEXT_PUBLIC_LOGIN_EMAIL || "admin@barangayhidalgo.gov.ph";
  const VALID_PASSWORD = process.env.NEXT_PUBLIC_LOGIN_PASSWORD || "solar2024";

  const handleLogin = (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError("Please enter a valid email address");
      setLoading(false);
      return;
    }

    // Simple validation
    if (email.toLowerCase().trim() === VALID_EMAIL.toLowerCase() && password === VALID_PASSWORD) {
      // Store login state
      if (typeof window !== "undefined") {
        sessionStorage.setItem("isAuthenticated", "true");
        sessionStorage.setItem("email", email.toLowerCase().trim());
      }
      router.push("/dashboard");
    } else {
      setError("Invalid email or password");
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Login — Solar Tracker</title>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
      </Head>
      <div className="login-wrap">
        <div className="login-card">
          <div className="login-header">
            <div className="sun"></div>
            <div className="login-title">Solar Tracker</div>
            <div className="login-subtitle">Barangay Hidalgo, Tanauan, Batangas</div>
            <div className="login-subtitle" style={{ marginTop: "4px", fontSize: "12px", opacity: 0.7 }}>Admin Access</div>
          </div>

          <form onSubmit={handleLogin} className="login-form">
            {error && (
              <div className="login-error">
                {error}
              </div>
            )}

            <div className="form-group">
              <label htmlFor="email">Email Address</label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email address"
                required
                autoFocus
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                required
                disabled={loading}
              />
            </div>

            <button
              type="submit"
              className="login-btn"
              disabled={loading}
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>

          <div className="login-footer">
            <span className="muted">Secure access to solar tracker dashboard</span>
          </div>
        </div>
      </div>
      <style jsx global>{`
        :root {
          --bg: #0b1020;
          --card: #121a33;
          --ink: #e6f0ff;
          --muted: #9fb3d1;
          --accent: #2fd27a;
          --grid: #1b2547;
        }
        * {
          box-sizing: border-box;
        }
        body {
          margin: 0;
          font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
          background: radial-gradient(1200px 600px at 20% -10%, #18306400, #18306488), var(--bg);
          color: var(--ink);
        }
        .login-wrap {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 32px 16px;
        }
        .login-card {
          width: 100%;
          max-width: 420px;
          background: linear-gradient(180deg, #101734, #0d142b);
          border: 1px solid var(--grid);
          border-radius: 14px;
          padding: 40px 32px;
          box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6);
        }
        .login-header {
          text-align: center;
          margin-bottom: 32px;
        }
        .sun {
          width: 24px;
          height: 24px;
          background: linear-gradient(180deg, #ffd24d, #ff9a3c);
          border-radius: 50%;
          box-shadow: 0 0 24px #ffb347a0;
          margin: 0 auto 16px;
        }
        .login-title {
          font-size: 28px;
          font-weight: 700;
          letter-spacing: 0.2px;
          margin-bottom: 8px;
        }
        .login-subtitle {
          font-size: 14px;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.4px;
        }
        .login-form {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .form-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .form-group label {
          font-size: 12px;
          color: var(--muted);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.4px;
        }
        .form-group input {
          background: #0e1833;
          border: 1px solid var(--grid);
          border-radius: 8px;
          padding: 12px 16px;
          color: var(--ink);
          font-size: 14px;
          outline: none;
          transition: border-color 0.2s;
        }
        .form-group input:focus {
          border-color: var(--accent);
        }
        .form-group input:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .login-btn {
          margin-top: 8px;
          padding: 14px;
          border-radius: 8px;
          background: linear-gradient(180deg, #2fd27a, #11a85a);
          border: none;
          color: #09151a;
          font-weight: 700;
          font-size: 14px;
          cursor: pointer;
          transition: opacity 0.2s;
        }
        .login-btn:hover:not(:disabled) {
          opacity: 0.9;
        }
        .login-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .login-error {
          background: rgba(255, 107, 107, 0.1);
          border: 1px solid #ff6b6b;
          border-radius: 8px;
          padding: 12px;
          color: #ff6b6b;
          font-size: 13px;
          text-align: center;
        }
        .login-footer {
          margin-top: 24px;
          text-align: center;
        }
        .muted {
          color: var(--muted);
          font-size: 12px;
        }
      `}</style>
    </>
  );
}

