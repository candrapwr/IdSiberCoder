# ✅ Checklist Publikasi IdSiberCoder

## 🔍 Sebelum Publikasi

### [ ] Konfigurasi package.json
- [x] Publisher name sesuai (candrapwr)
- [x] Version number ditingkatkan (0.0.2)
- [x] Categories sesuai (Programming Languages, Snippets, AI)
- [x] Icon tersedia (media/icon.png)
- [x] Description jelas dan menarik
- [x] Keywords relevan
- [x] Repository URL valid
- [x] Bugs URL valid
- [x] Homepage URL valid

### [ ] Testing
- [ ] Extension bisa diinstall lokal
- [ ] Sidebar berfungsi
- [ ] Chat interface responsive
- [ ] File operations work
- [ ] DeepSeek integration works
- [ ] No console errors

### [ ] Dokumentasi
- [x] README.md user-friendly
- [x] README_DEVELOPER.md teknis
- [x] CHANGELOG.md updated
- [x] LICENSE valid

## 🚀 Proses Publikasi

### [ ] Setup Tools
- [ ] Install vsce: `npm install -g vsce`
- [ ] Buat Azure DevOps account
- [ ] Buat Personal Access Token (PAT)
- [ ] Login: `vsce login candrapwr`

### [ ] Build & Package
- [ ] Build: `npm run esbuild`
- [ ] Package: `npm run package`
- [ ] Test .vsix file lokal

### [ ] Publish
- [ ] Publish: `npm run publish`
- [ ] Verifikasi di VS Code Marketplace
- [ ] Test install dari marketplace

## 📋 Post-Publikasi

### [ ] Marketing
- [ ] Update GitHub repository
- [ ] Share di social media
- [ ] Minta feedback dari komunitas
- [ ] Monitor download stats

### [ ] Maintenance
- [ ] Monitor issues di GitHub
- [ ] Plan untuk update berikutnya
- [ ] Collect user feedback

## ⚠️ Troubleshooting

### Common Issues:
- **Publisher name tidak ditemukan**: Pastikan sudah login dengan `vsce login`
- **Version conflict**: Tingkatkan version number di package.json
- **Icon tidak valid**: Gunakan PNG format, max 128x128px
- **PAT expired**: Buat token baru di Azure DevOps
- **Build error**: Pastikan semua dependencies terinstall

## 📞 Support
- GitHub Issues: https://github.com/candrapwr/IdSiberCoder/issues
- Email: [your-email] (opsional)
- Documentation: README.md