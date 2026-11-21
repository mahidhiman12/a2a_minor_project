"""
Start all five agents, each as its own independent process (like separate
department servers), then open http://127.0.0.1:8000/login in your browser.

    python run_all.py            # start everything
    python run_all.py --reset    # wipe the simulated databases first
    python run_all.py --with-sanitation   # also start a 4th department (extensibility demo)
Press Ctrl+C to stop all agents.
"""
import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.request

from common import config

AGENTS = [  # (name, module, port)  - department agents first, host last
    ("water", "agents.domain.water:app", config.PORTS["water"]),
    ("electricity", "agents.domain.electricity:app", config.PORTS["electricity"]),
    ("roads", "agents.domain.roads:app", config.PORTS["roads"]),
    ("orchestrator", "agents.orchestrator.server:app", config.PORTS["orchestrator"]),
    ("concierge", "agents.concierge.server:app", config.PORTS["concierge"]),
]


def wait_up(port, timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        try:
            urllib.request.urlopen(f"http://{config.HOST}:{port}/.well-known/agent-card.json", timeout=1)
            return True
        except Exception:
            time.sleep(0.3)
    return False


def main():
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    if "--with-sanitation" in sys.argv:  # extensibility demo: 4th department
        port = int(os.getenv("SANITATION_PORT", 8104))
        os.environ["DOMAIN_AGENT_URLS"] = ",".join(config.DOMAIN_AGENT_URLS + [f"http://{config.HOST}:{port}"])
        AGENTS.insert(3, ("sanitation", "agents.domain.sanitation:app", port))
    if "--reset" in sys.argv and config.DB_DIR.exists():
        shutil.rmtree(config.DB_DIR)
        config.DB_DIR.mkdir(parents=True)
        print("Databases reset.")
    procs = []
    try:
        for name, module, port in AGENTS:
            p = subprocess.Popen([sys.executable, "-m", "uvicorn", module, "--host", config.HOST,
                                  "--port", str(port), "--log-level", "warning"],
                                 cwd=str(config.ROOT))
            procs.append(p)
            ok = wait_up(port)
            print(f"  {'OK ' if ok else 'ERR'} {name:<13} http://{config.HOST}:{port}")
        print(f"\nNLU mode: {config.NLU_MODE}")
        base = f"http://{config.HOST}:{config.PORTS['concierge']}"
        print(f"Log in here:           {base}/login")
        print("  citizen -> citizen chat,  <department>_officer -> " + base + "/dept/<department>,"
              "  admin -> " + base + "/admin")
        print("  (demo passwords: README 'Login & roles' / your .env)")
        if (config.ROOT / "frontend" / "dist" / "index.html").is_file():
            print("Website: the React app from frontend/dist is served on " + base)
        else:
            print("Website not built yet - showing the classic pages. Build it with:\n"
                  "  cd frontend && npm install && npm run build\n"
                  "or develop with hot reload:  cd frontend && npm run dev  ->  http://localhost:5173")
        print("Press Ctrl+C to stop.\n")
        while all(p.poll() is None for p in procs):
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        for p in procs:
            p.terminate()
        print("Stopped all agents.")


if __name__ == "__main__":
    main()
