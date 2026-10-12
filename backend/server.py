import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from lib.db import client, ensure_indexes  # noqa: E402
from lib.engine import run_forever  # noqa: E402
from routers import activity, ai, analytics, auth, campaigns, inbox, notifications, senders  # noqa: E402

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.index_task = asyncio.create_task(ensure_indexes())
    app.state.engine_task = asyncio.create_task(run_forever())
    yield
    app.state.engine_task.cancel()
    client.close()


app = FastAPI(lifespan=lifespan, title="OutreachForge API")
api_router = APIRouter(prefix="/api")


@api_router.get("/")
async def root():
    return {"message": "OutreachForge API", "ok": True}


for r in (auth.router, senders.router, campaigns.router, inbox.router, analytics.router, notifications.router, activity.router, ai.router):
    api_router.include_router(r)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include the router in the main app — keep last
app.include_router(api_router)
