import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import text

DATABASE_URL = "postgresql+asyncpg://forge:ForgeKB2025!@localhost:5434/forge_kb"

engine = create_async_engine(DATABASE_URL, echo=False, pool_size=10, max_overflow=20)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def init_db():
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS kb_documents (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                text TEXT NOT NULL,
                embedding vector(768) NOT NULL,
                source VARCHAR(20) NOT NULL DEFAULT 'manual',
                source_label VARCHAR(255) NOT NULL DEFAULT '',
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        """))
        # Check if index exists before creating (ivfflat needs rows to be effective)
        result = await conn.execute(text("""
            SELECT 1 FROM pg_indexes WHERE indexname = 'idx_kb_embedding'
        """))
        if not result.fetchone():
            # Use HNSW index - works on empty tables unlike ivfflat
            await conn.execute(text("""
                CREATE INDEX idx_kb_embedding
                ON kb_documents USING hnsw (embedding vector_cosine_ops)
            """))


async def get_session() -> AsyncSession:
    async with async_session() as session:
        yield session
