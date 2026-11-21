"""
Run every agent inside ONE Python process - for small hosts such as Render's free tier
(512 MB of memory), where five separate Python processes would not fit.

Each agent is still its own FastAPI app on its own port, and they still talk to each other
over HTTP with A2A (Agent Cards, JSON-RPC), exactly as with run_all.py. Only the Concierge
(website + API) listens publicly; the department agents and the Orchestrator listen on
127.0.0.1 inside the container.

    python serve_all.py                     # Concierge on CONCIERGE_PORT (Render: $PORT)
    WITH_SANITATION=1 python serve_all.py   # also the 4th department

For local development keep using run_all.py (one process per agent, like real departments).
"""
import asyncio
import contextlib
import os
import signal
import sys

import uvicorn

from common import config


class Server(uvicorn.Server):
    """Signals are handled once for all servers (below), not by each server."""

    @contextlib.contextmanager
    def capture_signals(self):  # uvicorn >= 0.29
        yield

    def install_signal_handlers(self):  # older uvicorn
        pass


def agents() -> list[tuple[str, str, int]]:
    out = [("water", "agents.domain.water:app", config.PORTS["water"]),
           ("electricity", "agents.domain.electricity:app", config.PORTS["electricity"]),
           ("roads", "agents.domain.roads:app", config.PORTS["roads"])]
    if os.getenv("WITH_SANITATION") or "--with-sanitation" in sys.argv:
        port = int(os.getenv("SANITATION_PORT", 8104))
        out.append(("sanitation", "agents.domain.sanitation:app", port))
        url = f"http://{config.HOST}:{port}"
        if url not in config.DOMAIN_AGENT_URLS:  # the Orchestrator reads this list on discovery
            config.DOMAIN_AGENT_URLS.append(url)
    out.append(("orchestrator", "agents.orchestrator.server:app", config.PORTS["orchestrator"]))
    return out


async def main():
    public_host = os.getenv("PUBLIC_HOST", "0.0.0.0")
    log_level = os.getenv("LOG_LEVEL", "warning")
    internal = [Server(uvicorn.Config(module, host=config.HOST, port=port, log_level=log_level))
                for _, module, port in agents()]
    concierge = Server(uvicorn.Config("agents.concierge.server:app", host=public_host,
                                      port=config.PORTS["concierge"], log_level=log_level,
                                      proxy_headers=True, forwarded_allow_ips="*"))
    everyone = internal + [concierge]

    def stop(*_):
        for s in everyone:
            s.should_exit = True
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        with contextlib.suppress(NotImplementedError, RuntimeError, ValueError):  # Windows
            loop.add_signal_handler(sig, stop)

    # Departments and the Orchestrator first, so the Concierge's start-up discovery
    # (which creates the <department>_officer logins) finds them.
    tasks = [asyncio.create_task(s.serve()) for s in internal]
    for _ in range(300):
        if all(s.started for s in internal) or any(t.done() for t in tasks):
            break
        await asyncio.sleep(0.1)
    tasks.append(asyncio.create_task(concierge.serve()))
    print(f"All agents running in one process. Website and API: http://{public_host}:{config.PORTS['concierge']}",
          flush=True)
    try:
        await asyncio.gather(*tasks)
    except (KeyboardInterrupt, asyncio.CancelledError):
        stop()


if __name__ == "__main__":
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(main())
