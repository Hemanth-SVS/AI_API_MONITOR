const { execSync } = require('child_process');
const fs = require('fs');

const script = `
old_email="lovable-dev[bot]@users.noreply.github.com"
old_name="lovable-dev[bot]"
correct_name="Hemanth-SVS"
correct_email="hemanthsunkara2007@gmail.com"

if [ "$GIT_COMMITTER_EMAIL" = "$old_email" ] || [ "$GIT_COMMITTER_NAME" = "$old_name" ]; then
    export GIT_COMMITTER_NAME="$correct_name"
    export GIT_COMMITTER_EMAIL="$correct_email"
fi
if [ "$GIT_AUTHOR_EMAIL" = "$old_email" ] || [ "$GIT_AUTHOR_NAME" = "$old_name" ]; then
    export GIT_AUTHOR_NAME="$correct_name"
    export GIT_AUTHOR_EMAIL="$correct_email"
fi
`;

fs.writeFileSync('rewrite.sh', script);

try {
  execSync('git filter-branch -f --env-filter "source ./rewrite.sh" HEAD', { stdio: 'inherit' });
} catch (e) {
  console.error("Rewrite failed:", e.message);
} finally {
  fs.unlinkSync('rewrite.sh');
}
