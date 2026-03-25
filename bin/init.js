#!/usr/bin/env node

import { select, input, password } from '@inquirer/prompts'
import ora   from 'ora'
import chalk from 'chalk'
import fs    from 'fs'
import path  from 'path'
import { execSync }       from 'child_process'
import { generateConfig } from './templates.js'

// ── Welcome ────────────────────────────────────────

console.log()
console.log(chalk.bold('  ✦ greymemory') + chalk.dim(' — private memory for AI agents'))
console.log()

// ── Questions ──────────────────────────────────────

const extractorProvider = await select({
  message: 'Extraction provider:',
  choices: [
    { name: 'Anthropic', value: 'Anthropic' },
    { name: 'OpenAI',    value: 'OpenAI'    },
    { name: 'Ollama',    value: 'Ollama'    }
  ]
})

const extractorModel = await select({
  message: 'Extraction model:',
  choices: extractorProvider === 'Anthropic'
    ? [
        { name: 'claude-haiku-4-5-20251001  (fast, cheap — recommended)', value: 'claude-haiku-4-5-20251001' },
        { name: 'claude-sonnet-4-6          (smarter)',                    value: 'claude-sonnet-4-6'         },
        { name: 'claude-opus-4-6            (best, most expensive)',       value: 'claude-opus-4-6'           }
      ]
    : extractorProvider === 'OpenAI'
    ? [
        { name: 'gpt-4o-mini  (fast, cheap — recommended)', value: 'gpt-4o-mini' },
        { name: 'gpt-4o       (smarter, costs more)',        value: 'gpt-4o'      }
      ]
    : [
        { name: 'llama3',   value: 'llama3'   },
        { name: 'llama3.1', value: 'llama3.1' },
        { name: 'mistral',  value: 'mistral'  },
        { name: 'custom',   value: 'custom'   }
      ]
})

const extractorModelFinal = extractorModel === 'custom'
  ? await input({ message: 'Enter Ollama model name:' })
  : extractorModel

// API key for cloud extractors
let extractorKey = ''
if (extractorProvider === 'Anthropic') {
  extractorKey = await password({
    message:  'Anthropic API key:',
    mask:     '*',
    validate: (k) => k.startsWith('sk-ant-') || 'Key should start with sk-ant-'
  })
}
if (extractorProvider === 'OpenAI') {
  extractorKey = await password({
    message:  'OpenAI API key:',
    mask:     '*',
    validate: (k) => k.startsWith('sk-') || 'Key should start with sk-'
  })
}

const embedderProvider = await select({
  message: 'Embedding provider:',
  choices: [
    { name: 'Ollama  (free, local)', value: 'Ollama'  },
    { name: 'OpenAI  (paid)',        value: 'OpenAI'  },
    { name: 'Cohere  (paid)',        value: 'Cohere'  }
  ]
})

const embedderModel = await select({
  message: 'Embedding model:',
  choices: embedderProvider === 'Ollama'
    ? [
        { name: 'mxbai-embed-large   (recommended)', value: 'mxbai-embed-large'  },
        { name: 'nomic-embed-text    (lighter)',      value: 'nomic-embed-text'   },
        { name: 'custom',                             value: 'custom'             }
      ]
    : embedderProvider === 'OpenAI'
    ? [
        { name: 'text-embedding-3-small  (fast, cheap — recommended)', value: 'text-embedding-3-small' },
        { name: 'text-embedding-3-large  (higher quality)',             value: 'text-embedding-3-large' }
      ]
    : [
        { name: 'embed-english-v3.0       (English only)',   value: 'embed-english-v3.0'      },
        { name: 'embed-multilingual-v3.0  (100+ languages)', value: 'embed-multilingual-v3.0' }
      ]
})

const embedderModelFinal = embedderModel === 'custom'
  ? await input({ message: 'Enter Ollama embedding model name:' })
  : embedderModel

// API key for cloud embedders
let embedderKey = ''
if (embedderProvider === 'OpenAI') {
  embedderKey = await password({
    message:  'OpenAI API key for embeddings:',
    mask:     '*',
    validate: (k) => k.startsWith('sk-') || 'Key should start with sk-'
  })
}
if (embedderProvider === 'Cohere') {
  embedderKey = await password({
    message: 'Cohere API key:',
    mask:    '*'
  })
}

const dir = await input({
  message: 'Storage directory:',
  default: '.greymemory'
})

const container = await input({
  message: 'Container name:',
  default: 'default'
})

console.log()

// ── Generate config ────────────────────────────────

const configSpinner = ora('Generating greymemory.config.js...').start()

const config     = generateConfig({
  extractorProvider,
  extractorModel:   extractorModelFinal,
  embedderProvider,
  embedderModel:    embedderModelFinal,
  dir,
  container
})

const outputPath = path.join(process.cwd(), 'greymemory.config.js')
fs.writeFileSync(outputPath, config, 'utf-8')

configSpinner.succeed('greymemory.config.js created')

// ── Write .env ─────────────────────────────────────

const envLines = []
if (extractorProvider === 'Anthropic')                                envLines.push(`ANTHROPIC_API_KEY=${extractorKey}`)
if (extractorProvider === 'OpenAI')                                   envLines.push(`OPENAI_API_KEY=${extractorKey}`)
if (embedderProvider  === 'OpenAI' && extractorProvider !== 'OpenAI') envLines.push(`OPENAI_API_KEY=${embedderKey}`)
if (embedderProvider  === 'Cohere')                                   envLines.push(`COHERE_API_KEY=${embedderKey}`)

if (envLines.length > 0) {
  const envSpinner = ora('Saving API keys to .env...').start()
  const envPath    = path.join(process.cwd(), '.env')
  const existing   = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : ''
  const toAdd      = envLines.filter(line => !existing.includes(line.split('=')[0]))

  if (toAdd.length > 0) {
    fs.appendFileSync(envPath, '\n' + toAdd.join('\n') + '\n')
  }

  envSpinner.succeed('.env updated')
}

// ── Update .gitignore ──────────────────────────────

const gitignorePath    = path.join(process.cwd(), '.gitignore')
const gitignoreContent = fs.existsSync(gitignorePath)
  ? fs.readFileSync(gitignorePath, 'utf-8')
  : ''

if (!gitignoreContent.includes('.env')) {
  fs.appendFileSync(gitignorePath, '\n.env\n')
  console.log(chalk.dim('  .env added to .gitignore'))
}

// ── Install dependencies ───────────────────────────

const packages = []
if (extractorProvider === 'Anthropic')                                    packages.push('@anthropic-ai/sdk')
if (extractorProvider === 'OpenAI')                                       packages.push('openai')
if (embedderProvider  === 'OpenAI' && extractorProvider !== 'OpenAI')     packages.push('openai')
if (embedderProvider  === 'Cohere')                                       packages.push('cohere-ai')
packages.push('dotenv')

if (packages.length > 0) {
  const installSpinner = ora(`Installing ${packages.join(', ')}...`).start()
  try {
    execSync(`npm install ${packages.join(' ')}`, { stdio: 'ignore' })
    installSpinner.succeed(`${packages.join(', ')} installed`)
  } catch (e) {
    installSpinner.fail(`Install failed. Run manually: npm install ${packages.join(' ')}`)
  }
}

// ── Done ───────────────────────────────────────────

console.log()
console.log(chalk.bold('  ✦ Ready. Add to your project:'))
console.log()
console.log(chalk.dim("  import memory from './greymemory.config.js'"))
console.log(chalk.dim("  await memory.add(messages)"))
console.log(chalk.dim("  await memory.search('query')"))
console.log()
console.log(chalk.yellow('  ⚠ Never commit .env to git. Your API keys are inside.'))
console.log()