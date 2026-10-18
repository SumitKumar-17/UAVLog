from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str
    data_dir: str = "/data"
    openai_api_key: str = ""
    openai_api_base: str = "https://api.openai.com/v1"
    llm_model: str = "gpt-4o-mini"
    embed_model: str = "text-embedding-3-small"
    embed_dims: int = 1536
    nlsql_database_url: str = ""  # optional: connect as the restricted login role uav_nlsql instead of SET ROLE from the app user

    @property
    def dsn(self) -> str:
        """Plain libpq-style URL for psycopg (drops the SQLAlchemy driver suffix)."""
        return self.database_url.replace("+psycopg", "")


settings = Settings()
