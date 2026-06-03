import { PrismaClient } from '@prisma/client';
import { hashCredential, isHashedCredential } from '../src/utils/hash.js';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.roleAccessMatrix.findMany({
    select: { id: true, loginId: true, pin: true },
  });

  let migrated = 0;
  for (const user of users) {
    if (!user.pin || isHashedCredential(user.pin)) continue;
    await prisma.roleAccessMatrix.update({
      where: { id: user.id },
      data: { pin: await hashCredential(user.pin) },
    });
    migrated++;
    console.log(`Migrated PIN for ${user.loginId}`);
  }

  console.log(`Role PIN migration complete. Migrated: ${migrated}`);
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
