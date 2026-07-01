export function getBranchFilter(req) {
  const branch = req.userBranch;
  if (!branch) return {};
  return { branch };
}

export function getBranchFilterFor(entity) {
  return (req) => {
    const branch = req.userBranch;
    if (!branch) return {};
    return { [entity]: { branch } };
  };
}
