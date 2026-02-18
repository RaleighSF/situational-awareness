"""ChromaDB vector store for semantic caption search."""

import chromadb
from chromadb.config import Settings as ChromaSettings

_client: chromadb.ClientAPI | None = None
_collection: chromadb.Collection | None = None

COLLECTION_NAME = "vss_captions"


def get_chroma_client(persist_dir: str) -> chromadb.ClientAPI:
    """Get or create the ChromaDB persistent client."""
    global _client
    if _client is None:
        _client = chromadb.PersistentClient(
            path=persist_dir,
            settings=ChromaSettings(anonymized_telemetry=False),
        )
    return _client


def get_chroma_collection(persist_dir: str) -> chromadb.Collection:
    """Get or create the captions collection."""
    global _collection
    if _collection is None:
        client = get_chroma_client(persist_dir)
        _collection = client.get_or_create_collection(
            name=COLLECTION_NAME,
            metadata={"hnsw:space": "cosine"},
        )
    return _collection


def add_caption(
    collection: chromadb.Collection,
    chroma_id: str,
    caption_text: str,
    embedding: list[float],
    metadata: dict,
):
    """Add a single caption with its embedding to the collection."""
    collection.add(
        ids=[chroma_id],
        embeddings=[embedding],
        documents=[caption_text],
        metadatas=[metadata],
    )


def search_captions(
    collection: chromadb.Collection,
    query_embedding: list[float],
    n_results: int = 10,
    where: dict | None = None,
) -> dict:
    """Search for similar captions using a query embedding.

    Returns ChromaDB query results with ids, distances, documents, and metadatas.
    """
    kwargs = {
        "query_embeddings": [query_embedding],
        "n_results": n_results,
        "include": ["documents", "metadatas", "distances"],
    }
    if where:
        kwargs["where"] = where

    return collection.query(**kwargs)
