#!/usr/bin/env node
import { faker } from '@faker-js/faker'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { prisma } from '../src/db/prisma.js'

// Simple seeder using faker. Configure counts via environment vars.
const NUM_USERS = Number(process.env.SEED_USERS || 12)
const MAX_POSTS_PER_USER = Number(process.env.SEED_MAX_POSTS || 6)
const MAX_COMMENTS_PER_POST = Number(process.env.SEED_MAX_COMMENTS || 6)
const MAX_FRIEND_REQUESTS = Number(process.env.SEED_FRIEND_REQUESTS || 20)
const MAX_CONVERSATIONS = Number(process.env.SEED_CONVERSATIONS || 6)
const MAX_MESSAGES_PER_CONVO = Number(process.env.SEED_MESSAGES || 20)

function randRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

async function main() {
  console.log('Seeding database with faker data...')

  const users = []
  for (let i = 0; i < NUM_USERS; i++) {
    const name = faker.person.fullName()
    const email = `user${i + 1}@example.test`
    const passwordHash = bcrypt.hashSync('password', 8)
    const bio = faker.lorem.sentences(2)
    // Use Gravatar based on email (identicon fallback)
    const hash = crypto.createHash('md5').update(email.trim().toLowerCase()).digest('hex')
    const avatarUrl = `https://www.gravatar.com/avatar/${hash}?s=200&d=identicon&r=pg`

    const u = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        name,
        bio,
        passwordHash,
        avatarUrl,
      },
    })
    users.push(u)
  }

  // Create posts
  const posts = []
  for (const u of users) {
    const count = randRange(0, MAX_POSTS_PER_USER)
    for (let i = 0; i < count; i++) {
      const content = faker.lorem.sentences(randRange(1, 3))
      const hasMedia = Math.random() < 0.3
      const photoUrl = hasMedia ? `https://picsum.photos/seed/${Math.random().toString(36).slice(2,9)}/800/450` : null
      const mediaType = hasMedia && Math.random() < 0.2 ? 'VIDEO' : null

      const p = await prisma.post.create({
        data: {
          content,
          photoUrl,
          mediaType,
          authorId: u.id,
        },
      })
      posts.push(p)
    }
  }

  // Comments
  const comments = []
  for (const p of posts) {
    const count = randRange(0, MAX_COMMENTS_PER_POST)
    for (let i = 0; i < count; i++) {
      const author = users[Math.floor(Math.random() * users.length)]
      const c = await prisma.comment.create({
        data: {
          content: faker.lorem.sentence(),
          postId: p.id,
          authorId: author.id,
        },
      })
      comments.push(c)
    }
  }

  // Likes for posts and comments
  for (const p of posts) {
    const likeCount = randRange(0, Math.min(users.length, 6))
    const shuffled = faker.helpers.shuffle(users).slice(0, likeCount)
    if (shuffled.length) {
      await prisma.post.update({
        where: { id: p.id },
        data: { likedBy: { connect: shuffled.map((u) => ({ id: u.id })) } },
      })
    }
  }

  for (const c of comments) {
    const likeCount = randRange(0, Math.min(users.length, 4))
    const shuffled = faker.helpers.shuffle(users).slice(0, likeCount)
    if (shuffled.length) {
      await prisma.comment.update({
        where: { id: c.id },
        data: { likedBy: { connect: shuffled.map((u) => ({ id: u.id })) } },
      })
    }
  }

  // Friend requests (some accepted)
  for (let i = 0; i < MAX_FRIEND_REQUESTS; i++) {
    const a = users[Math.floor(Math.random() * users.length)]
    const b = users[Math.floor(Math.random() * users.length)]
    if (a.id === b.id) continue
    try {
      await prisma.friendRequest.create({
        data: {
          senderId: a.id,
          receiverId: b.id,
          status: Math.random() < 0.5 ? 'PENDING' : 'ACCEPTED',
        },
      })
    } catch (err) {
      // ignore unique errors
    }
  }

  // Conversations + messages
  for (let i = 0; i < MAX_CONVERSATIONS; i++) {
    const size = randRange(2, Math.min(6, users.length))
    const members = faker.helpers.shuffle(users).slice(0, size)
    const conv = await prisma.conversation.create({
      data: {
        title: size > 2 ? faker.company.name() : null,
        isGroup: size > 2,
        members: { create: members.map((m) => ({ userId: m.id })) },
      },
      include: { members: true },
    })

    const messageCount = randRange(1, MAX_MESSAGES_PER_CONVO)
    for (let j = 0; j < messageCount; j++) {
      const sender = members[Math.floor(Math.random() * members.length)]
      await prisma.message.create({
        data: {
          content: faker.lorem.sentence(),
          senderId: sender.id,
          conversationId: conv.id,
        },
      })
    }
  }

  console.log('Seeding complete.')
}

main()
  .catch((err) => {
    console.error('Seeder error', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
