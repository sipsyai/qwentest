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

        # Unique index on text hash to prevent duplicates
        result = await conn.execute(text("""
            SELECT 1 FROM pg_indexes WHERE indexname = 'idx_kb_text_unique'
        """))
        if not result.fetchone():
            await conn.execute(text("""
                CREATE UNIQUE INDEX idx_kb_text_unique ON kb_documents ((md5(text)))
            """))

        # App settings (key-value store)
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS app_settings (
                key        VARCHAR(100) PRIMARY KEY,
                value      TEXT NOT NULL DEFAULT '',
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        """))

        # Request history (structured)
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS request_history (
                id          VARCHAR(50) PRIMARY KEY,
                method      VARCHAR(10) NOT NULL,
                endpoint    VARCHAR(255) NOT NULL,
                model       VARCHAR(255) NOT NULL,
                timestamp   VARCHAR(50) NOT NULL,
                duration    VARCHAR(20) NOT NULL,
                tokens      INTEGER NOT NULL DEFAULT 0,
                status      INTEGER NOT NULL,
                status_text VARCHAR(100) NOT NULL DEFAULT '',
                preview     TEXT NOT NULL DEFAULT '',
                created_at  TIMESTAMPTZ DEFAULT NOW()
            )
        """))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_history_created_at
            ON request_history (created_at DESC)
        """))

        # Datasets table
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS datasets (
                id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name            VARCHAR(255) NOT NULL,
                url             TEXT NOT NULL DEFAULT '',
                method          VARCHAR(10) NOT NULL DEFAULT 'GET',
                token           TEXT NOT NULL DEFAULT '',
                headers         JSONB NOT NULL DEFAULT '{}',
                array_path      TEXT NOT NULL DEFAULT '',
                extract_fields  JSONB NOT NULL DEFAULT '[]',
                created_at      TIMESTAMPTZ DEFAULT NOW(),
                updated_at      TIMESTAMPTZ DEFAULT NOW()
            )
        """))

        # Add new columns to existing datasets table (migration)
        await conn.execute(text("""
            ALTER TABLE datasets ADD COLUMN IF NOT EXISTS array_path TEXT NOT NULL DEFAULT ''
        """))
        await conn.execute(text("""
            ALTER TABLE datasets ADD COLUMN IF NOT EXISTS extract_fields JSONB NOT NULL DEFAULT '[]'
        """))
        await conn.execute(text("""
            ALTER TABLE datasets ADD COLUMN IF NOT EXISTS raw_data JSONB DEFAULT NULL
        """))

        # Dataset records table
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS dataset_records (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                dataset_id  UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
                data        JSONB NOT NULL,
                json_path   TEXT NOT NULL DEFAULT '$',
                label       TEXT NOT NULL DEFAULT '',
                created_at  TIMESTAMPTZ DEFAULT NOW()
            )
        """))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_dataset_records_dataset_id
            ON dataset_records (dataset_id, created_at DESC)
        """))

        # Unique index on (dataset_id, data hash) to prevent duplicate records
        result = await conn.execute(text("""
            SELECT 1 FROM pg_indexes WHERE indexname = 'idx_dataset_records_unique_data'
        """))
        if not result.fetchone():
            # Remove existing duplicates before creating unique index
            await conn.execute(text("""
                DELETE FROM dataset_records
                WHERE id NOT IN (
                    SELECT DISTINCT ON (dataset_id, md5(data::text)) id
                    FROM dataset_records
                    ORDER BY dataset_id, md5(data::text), created_at ASC
                )
            """))
            await conn.execute(text("""
                CREATE UNIQUE INDEX idx_dataset_records_unique_data
                ON dataset_records (dataset_id, md5(data::text))
            """))

        # Seed default settings if table is empty
        result = await conn.execute(text("SELECT COUNT(*) FROM app_settings"))
        count = result.scalar()
        if count == 0:
            defaults = [
                ('forge_chat_url', '/api/chat'),
                ('forge_embed_url', '/api/embed'),
                ('forge_chat_fallback_url', ''),
                ('forge_embed_fallback_url', ''),
                ('forge_api_key', 'EMPTY'),
            ]
            for key, value in defaults:
                await conn.execute(
                    text("INSERT INTO app_settings (key, value) VALUES (:key, :value)"),
                    {"key": key, "value": value}
                )


async def get_session() -> AsyncSession:
    async with async_session() as session:
        yield session
