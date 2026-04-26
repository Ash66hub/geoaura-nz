import os
import io
import time
import requests
from PyPDF2 import PdfReader
from supabase import create_client
from google import genai
from google.genai import types

# Load Environment Variables
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# Initialize Clients
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
genai_client = genai.Client(api_key=GEMINI_API_KEY)

def get_embedding(text):
    """Generates a 768-dimension embedding using gemini-embedding-2."""
    try:
        result = genai_client.models.embed_content(
            model="models/gemini-embedding-2",
            contents=text,
            config=types.EmbedContentConfig(
                task_type="RETRIEVAL_DOCUMENT",
                output_dimensionality=768
            )
        )
        return result.embeddings[0].values
    except Exception as e:
        print(f"Embedding error: {e}")
        return None

def is_already_ingested(url, chunk_index):
    """Checks if this specific chunk has already been uploaded."""
    res = supabase.table("regulatory_documents") \
        .select("id") \
        .eq("metadata->>source_url", url) \
        .eq("metadata->>chunk_index", str(chunk_index)) \
        .execute()
    return len(res.data) > 0

def ingest_pdf_from_url(url, doc_type):
    """Downloads a PDF, extracts text, chunks it, and uploads if missing."""
    print(f"\n--- Processing: {url} ---")
    
    response = requests.get(url)
    response.raise_for_status()
    pdf_file = io.BytesIO(response.content)
    
    reader = PdfReader(pdf_file)
    full_text = ""
    for page in reader.pages:
        full_text += page.extract_text() + "\n"
    
    chunk_size = 1000
    overlap = 200
    chunks = []
    for i in range(0, len(full_text), chunk_size - overlap):
        chunks.append(full_text[i:i + chunk_size])
    
    print(f"Total chunks to check: {len(chunks)}")
    
    for i, chunk in enumerate(chunks):
        if not chunk.strip(): continue
        
        # Check if we should skip
        if is_already_ingested(url, i):
            if i % 20 == 0:
                print(f"Skipping chunk {i} (already exists)...")
            continue
            
        print(f"Ingesting chunk {i}/{len(chunks)}...")
        embedding = get_embedding(chunk)
        
        if embedding:
            data = {
                "content": chunk,
                "document_type": doc_type,
                "metadata": {"source_url": url, "chunk_index": i},
                "embedding": embedding
            }
            supabase.table("regulatory_documents").insert(data).execute()
            
            # Small delay to prevent rate limits
            time.sleep(1.5)

    print(f"Finished check/ingestion for {doc_type}!")

if __name__ == "__main__":
    urls = [
       '// ENTER URLs HERE'
    ]
    
    for url in urls:
        try:
            ingest_pdf_from_url(url, "building_code")
        except Exception as e:
            print(f"Failed to ingest {url}: {e}")
