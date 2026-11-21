import os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

VAULT_KEY = bytes.fromhex("8459974961f5e97d6ce6c5b816641ce116c611d59f1e401bc63d0662edfee574")
here = os.path.dirname(os.path.abspath(__file__))
src = os.path.join(here, "加密PDF_38页_原件.bin")
blob = open(src, "rb").read()
assert blob[:6] == b"QLGO1\n"
plain = AESGCM(VAULT_KEY).decrypt(blob[6:18], blob[18:], None)
out = os.path.join(here, "加密PDF_38页.pdf")
open(out, "wb").write(plain)
print(f"decrypted {len(plain)} bytes, magic={plain[:8]!r}")
