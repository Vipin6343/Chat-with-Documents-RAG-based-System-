"""Stop the server before running: python -m app.reindex WORKSPACE_ID"""
import argparse
from uuid import UUID
import portalocker

from app.config import Settings
from app.services.providers import Providers
from app.services.storage import Store


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('workspace_id', type=UUID)
    args = parser.parse_args()
    settings = Settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    with portalocker.Lock(str(settings.data_dir / 'server.lock'), timeout=0):
        store = Store(settings, Providers(settings))
        try:
            store.reindex(str(args.workspace_id))
        finally:
            store.engine.dispose()
    print('Workspace reindexed successfully.')


if __name__ == '__main__':
    main()
