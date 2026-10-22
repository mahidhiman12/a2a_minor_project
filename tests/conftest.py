import os
import tempfile

os.environ["DB_DIR"] = tempfile.mkdtemp(prefix="a2a-test-")  # keep demo databases clean
os.environ["DEPT_DELAY"] = "0.05"
