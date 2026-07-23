# Tempo Website

Static GitHub Pages site for Tempo.

## Pages

- `/` - landing page
- `/privacy/` - privacy policy URL for App Store Connect
- `/terms/` - terms of service
- `/contact/` - support and legal contact

## Publish as a GitHub Pages project site

1. Create a new public GitHub repository, for example `tempo`.
2. Copy the contents of this `site/` folder into the root of that repository.
3. Commit and push to `main`.
4. In the repository on GitHub, open `Settings` -> `Pages`.
5. Under `Build and deployment`, choose `Deploy from a branch`.
6. Select `main` and `/(root)`, then save.
7. Your URLs will be:
   - Landing page: `https://<github-username>.github.io/tempo/`
   - Privacy policy: `https://<github-username>.github.io/tempo/privacy/`
   - Terms: `https://<github-username>.github.io/tempo/terms/`

Replace `<github-username>` and `tempo` with the actual account and repository names.

## Before App Store submission

- Confirm the email and postal address in `privacy/`, `terms/`, and `contact/`.
- Add the real App Store URL to the landing page when the app is live.
- Keep the in-app Privacy Policy and Terms screens aligned with these public pages.
