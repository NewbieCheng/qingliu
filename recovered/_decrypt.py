import os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

VAULT_KEY = bytes.fromhex("8459974961f5e97d6ce6c5b816641ce116c611d59f1e401bc63d0662edfee574")
assert len(VAULT_KEY) == 32

names = {
    "eb7aac61467cc8b6331f556c35975a9c": "增值税申报表_2026-10.pdf",
    "0be88e962b245209da148ed2050283d7": "增值税申报表_2025-12.pdf",
    "75a35f2c40b9b356a71822c671c32d77": "增值税申报表_2024-12.pdf",
}

here = os.path.dirname(os.path.abspath(__file__))
aead = AESGCM(VAULT_KEY)
for fid, outname in names.items():
    with open(os.path.join(here, fid), "rb") as f:
        blob = f.read()
    assert blob[:6] == b"QLGO1\n", fid
    nonce = blob[6:18]
    ct = blob[18:]
    plain = aead.decrypt(nonce, ct, None)
    outpath = os.path.join(here, outname)
    with open(outpath, "wb") as f:
        f.write(plain)
    print(f"{fid} -> {outname}: {len(plain)} bytes, magic={plain[:5]!r}")
