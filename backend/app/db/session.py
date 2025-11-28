from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}

engine = create_async_engine(settings.database_url, future=True, echo=False, connect_args=connect_args)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, autoflush=False, class_=AsyncSession)


async def get_session() -> AsyncSession:
    """FastAPI dependency to provide a database session."""
    async with SessionLocal() as session:
        yield session
