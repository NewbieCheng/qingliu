# Third-party notices

Go依赖以server/go.mod和go.sum为准；React及构建依赖以frontend/package-lock.json为准。各许可原文在licenses/中。

- github.com/go-pdf/fpdf v0.9.0: https://github.com/go-pdf/fpdf
- filippo.io/edwards25519 v1.2.0: https://filippo.io/edwards25519
- github.com/go-sql-driver/mysql v1.10.1: https://github.com/go-sql-driver/mysql
- github.com/richardlehane/msoleps v1.0.6: https://github.com/richardlehane/msoleps
- github.com/richardlehane/mscfb v1.0.9: https://github.com/richardlehane/mscfb
- github.com/tiendc/go-deepcopy v1.7.2: https://github.com/tiendc/go-deepcopy
- github.com/xuri/efp v0.0.3-0.20260924042702-217b81952dec: https://github.com/xuri/efp
- github.com/xuri/nfp v0.0.2-0.20250530014748-2ddeb826f9a9: https://github.com/xuri/nfp
- golang.org/x/crypto v0.58.0: https://golang.org/x/crypto
- golang.org/x/net v0.62.0: https://golang.org/x/net
- golang.org/x/text v0.43.0: https://golang.org/x/text
- github.com/xuri/excelize/v2 v2.11.1: https://github.com/xuri/excelize/v2

中文字体：Noto Sans SC，SIL Open Font License 1.1，见fonts/OFL.txt。来源：https://github.com/notofonts/noto-cjk 。

Linux运行镜像通过Debian安装Poppler、MuPDF、Tesseract及其依赖。这些独立命令行工具的版权/许可文件保留在镜像/usr/share/doc中；对应源码可通过Debian软件包仓库获取。本源码包没有直接捆绑它们的二进制。