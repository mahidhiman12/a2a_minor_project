import os
import tempfile

os.environ["DB_DIR"] = tempfile.mkdtemp(prefix="a2a-test-")  # keep demo databases clean
os.environ["DEPT_DELAY"] = "0.05"
os.environ["SECRET_KEY"] = "test-secret-key"
os.environ["SERVICE_TOKEN"] = "test-service-token"
os.environ["DEMO_CITIZEN_PASSWORD"] = "citizen-test-pw"
os.environ["DEMO_OFFICER_PASSWORD"] = "officer-test-pw"
os.environ["DEMO_ADMIN_PASSWORD"] = "admin-test-pw"
