from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str
    data_dir: str = "/data"

    @property
    def dsn(self) -> str:
        """Plain libpq-style URL for psycopg (drops the SQLAlchemy driver suffix)."""
        return self.database_url.replace("+psycopg", "")


settings = Settings()
