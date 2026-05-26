import { NextRequest, NextResponse } from 'next/server'

const DEFAULT_MODEL = 'google/gemini-3.1-flash-image-preview'

export async function POST(request: NextRequest) {
  try {
    const { prompt, width, height, artStyle, apiKey, model } = await request.json()

    if (!prompt || !width || !height) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    const openRouterKey = (typeof apiKey === 'string' && apiKey.trim())
      ? apiKey.trim()
      : process.env.OPENROUTER_API_KEY

    if (!openRouterKey) {
      return NextResponse.json(
        { error: 'OpenRouter API key missing. Add one in Settings.' },
        { status: 401 }
      )
    }

    const modelId = (typeof model === 'string' && model.trim()) ? model.trim() : DEFAULT_MODEL

    // Art style descriptions
    const artStyleDescriptions: { [key: string]: string } = {
      'cinematic': 'cinematic photography with dramatic lighting and film grain',
      'vintage': 'vintage film photography with faded colors and retro feel',
      'black-white': 'black and white photography with rich contrast',
      'macro': 'macro photography with shallow depth of field',
      'oil-painting': 'oil painting style with visible brush strokes and rich textures',
      'watercolor': 'watercolor painting with soft washes and flowing colors',
      'impressionism': 'impressionist painting style with loose brushwork',
      'abstract': 'abstract art with bold shapes and colors',
      'pop-art': 'pop art style with bold colors and graphic elements',
      'cubism': 'cubist style with geometric shapes and multiple perspectives',
      'minimalist': 'minimalist art with simple forms and limited colors',
      'digital-art': 'digital art with smooth gradients and modern aesthetics',
      'cyberpunk': 'cyberpunk style with neon colors and futuristic elements',
      'vaporwave': 'vaporwave aesthetic with pastel colors and retro-futuristic vibes',
      'low-poly': 'low poly 3D art with geometric faceted surfaces',
      'pixel-art': 'pixel art style with retro video game aesthetics',
      '3d-render': '3D rendered look with realistic lighting and materials',
      'anime': 'anime/manga style with bold lines and vibrant colors',
      'cartoon': 'cartoon illustration with exaggerated features',
      'comic-book': 'comic book style with bold inking and halftone dots',
      'sketch': 'pencil sketch with cross-hatching and shading',
      'ink': 'ink drawing with bold black lines and dramatic contrast',
      'studio-ghibli': 'Studio Ghibli animation style with whimsical, hand-drawn aesthetics and rich environmental details',
      'pixar': 'Pixar animation style with smooth 3D rendering, expressive characters, and vibrant colors',
      'disney': 'Disney animation style with classic hand-drawn or modern 3D aesthetics and magical atmosphere',
      'dreamworks': 'DreamWorks animation style with dynamic expressions and cinematic lighting',
      'illumination': 'Illumination Entertainment style with bright colors, playful characters, and bold shapes',
      'laika': 'Laika Studios stop-motion style with intricate textures and handcrafted details',
      'cartoon-network': 'Cartoon Network style with bold outlines, simplified shapes, and vibrant colors',
      'nickelodeon': 'Nickelodeon animation style with energetic, expressive characters and bright color palettes',
      'aardman': 'Aardman claymation style with textured plasticine characters and British humor aesthetics',
      'blue-sky': 'Blue Sky Studios animation style with detailed 3D rendering and dynamic action sequences',
      'fantasy': 'fantasy art with magical and ethereal elements',
      'sci-fi': 'science fiction with futuristic technology and environments',
      'steampunk': 'steampunk style with Victorian-era and industrial elements',
      'surreal': 'surrealist style with dreamlike and impossible elements',
      'art-deco': 'Art Deco style with geometric patterns and elegant lines',
      'art-nouveau': 'Art Nouveau with flowing organic lines and natural motifs',
      'retro-80s': '1980s retro style with bright colors and bold graphics',
      'retro-50s': '1950s vintage style with pastel colors and classic aesthetics'
    }

    // Build the full prompt
    let fullPrompt = prompt
    
    if (artStyle && artStyleDescriptions[artStyle]) {
      fullPrompt = `Create an image in ${artStyleDescriptions[artStyle]}. ${prompt}`
    }
    
    fullPrompt += `\n\nIMPORTANT: Create a high-quality, detailed image at exactly ${width}x${height} pixels. The image should be complete and cohesive.`

    // Call OpenRouter API with image generation model
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': request.headers.get('referer') || 'http://localhost:3000',
        'X-Title': 'AI Image Extender - Generator',
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: fullPrompt,
              },
            ],
          },
        ],
        max_tokens: 2000,
        temperature: 0.7, // Higher temperature for more creative generation
      }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      console.error('OpenRouter API error:', errorData)
      return NextResponse.json(
        { error: errorData.error?.message || 'Failed to generate image' },
        { status: response.status }
      )
    }

    const data = await response.json()
    const message = data.choices?.[0]?.message
    
    if (!message) {
      return NextResponse.json(
        { error: 'No message in response' },
        { status: 500 }
      )
    }

    // Extract image from response (same logic as extend route)
    let imageUrl = null
    
    // Check if images array exists (Gemini 2.5 Flash format)
    if (message.images && Array.isArray(message.images) && message.images.length > 0) {
      const firstImage = message.images[0]
      if (firstImage.image_url?.url) {
        imageUrl = firstImage.image_url.url
      }
    }
    
    // If no image found in images array, check content
    if (!imageUrl) {
      const content = message.content
      
      if (Array.isArray(content)) {
        for (const part of content) {
          if (part.type === 'image_url' && part.image_url?.url) {
            imageUrl = part.image_url.url
            break
          }
          if (part.type === 'image' && part.url) {
            imageUrl = part.url
            break
          }
          if (part.image_url?.data) {
            imageUrl = `data:image/png;base64,${part.image_url.data}`
            break
          }
          if (part.data) {
            imageUrl = `data:image/png;base64,${part.data}`
            break
          }
          if (part.inline_data?.data) {
            const mimeType = part.inline_data.mime_type || 'image/png'
            imageUrl = `data:${mimeType};base64,${part.inline_data.data}`
            break
          }
        }
      } else if (typeof content === 'string') {
        if (content.startsWith('data:image') || content.startsWith('http')) {
          imageUrl = content
        } else if (content.length > 100 && /^[A-Za-z0-9+/=]+$/.test(content.substring(0, 100))) {
          imageUrl = `data:image/png;base64,${content}`
        }
      }
    }

    if (!imageUrl) {
      return NextResponse.json(
        { error: 'No image generated. The model may not support pure image generation.' },
        { status: 500 }
      )
    }

    return NextResponse.json({ imageUrl })
  } catch (error) {
    console.error('Error in generate route:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

