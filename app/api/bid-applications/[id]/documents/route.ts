import { NextRequest, NextResponse } from 'next/server'
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib'
import { supabaseAdmin, createServerSupabaseClient } from '../../../_supabaseAdmin'

// Force dynamic to avoid build-time initialization issues
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function fitTextToPageWidth(text: string, font: { widthOfTextAtSize: (t: string, s: number) => number }, fontSize: number, maxWidth: number): string {
  let fitted = text.trim()
  if (!fitted) return 'Bidding Company'
  while (fitted.length > 0 && font.widthOfTextAtSize(fitted, fontSize) > maxWidth) {
    fitted = fitted.slice(0, -1)
  }
  if (fitted.length < text.trim().length && fitted.length > 3) {
    fitted = `${fitted.slice(0, -3)}...`
  }
  return fitted || 'Bidding Company'
}

// Stamp every page with the bidding company name as the only watermark.
async function watermarkPdf(input: Buffer, biddingCompanyName: string): Promise<Buffer> {
  const pdf = await PDFDocument.load(input, { ignoreEncryption: true })
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const companyRaw =
    biddingCompanyName.replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim() || 'Bidding Company'

  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize()
    const pageMin = Math.min(width, height)
    const maxTextWidth = pageMin * 0.72
    const maxFontSize = pageMin * 0.11
    const minFontSize = 10

    let companyLine = companyRaw
    let fontSize = maxFontSize
    while (fontSize > minFontSize && bold.widthOfTextAtSize(companyLine, fontSize) > maxTextWidth) {
      fontSize -= 0.5
    }
    if (bold.widthOfTextAtSize(companyLine, fontSize) > maxTextWidth) {
      companyLine = fitTextToPageWidth(companyLine, bold, fontSize, maxTextWidth)
    }

    const textWidth = bold.widthOfTextAtSize(companyLine, fontSize)
    page.drawText(companyLine, {
      x: width / 2 - (textWidth / 2) * Math.cos(Math.PI / 4),
      y: height / 2 - (textWidth / 2) * Math.sin(Math.PI / 4),
      size: fontSize,
      font: bold,
      color: rgb(0.55, 0.55, 0.55),
      opacity: 0.18,
      rotate: degrees(45),
    })
  }

  return Buffer.from(await pdf.save())
}

async function getUserAndToken(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return { user: null, token: null }
  }

  const token = authHeader.substring(7)
  const { data: { user }, error } = await (supabaseAdmin as any).auth.getUser(token)

  if (error || !user) {
    return { user: null, token: null }
  }

  return { user, token }
}

// POST /api/bid-applications/[id]/documents - Upload document
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, token } = await getUserAndToken(request)

    if (!user || !token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabaseUser = createServerSupabaseClient(token)
    const { id } = await params

    // Get application (RLS sees user via token)
    const { data: app } = await supabaseUser
      .from('bid_applications')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!app) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 })
    }

    const appData = app as { status: string; deadline?: string }

    if (appData.status !== 'draft') {
      return NextResponse.json({ 
        error: 'Cannot upload documents to submitted application' 
      }, { status: 403 })
    }

    // Check deadline
    if (appData.deadline) {
      const deadline = new Date(appData.deadline)
      if (deadline < new Date()) {
        return NextResponse.json({ error: 'Submission deadline has passed' }, { status: 403 })
      }
    }

    const formData = await request.formData()
    const file = formData.get('file') as File
    const documentType = formData.get('document_type') as string
    const documentLabel = formData.get('document_label') as string | null
    const consortiumCompanyId = formData.get('consortium_company_id') as string | null

    if (!file || !documentType) {
      return NextResponse.json({ 
        error: 'file and document_type are required' 
      }, { status: 400 })
    }

    // Validate file type - PDF only (with extension fallback for browsers that send octet-stream)
    const isPdf = file.type === 'application/pdf'
      || ((file.type === 'application/octet-stream' || file.type === '')
          && file.name.toLowerCase().endsWith('.pdf'))

    if (!isPdf) {
      return NextResponse.json({ 
        error: 'Only PDF documents are allowed' 
      }, { status: 400 })
    }

    // Validate file size (50MB max)
    const maxSize = 50 * 1024 * 1024
    if (file.size > maxSize) {
      return NextResponse.json({ 
        error: 'File size must be less than 50MB' 
      }, { status: 400 })
    }

    // Get company name from application or user profile
    let companyName = (app as any).primary_applicant_name || ''
    
    // If no company name in application, try to get from user profile
    if (!companyName) {
      const { data: profile } = await supabaseUser
        .from('user_profiles')
        .select('company_name')
        .eq('id', user.id)
        .maybeSingle()

      companyName = (profile as any)?.company_name || 'Company'
    }

    // Use JV partner name on watermark when uploading a consortium company document
    let watermarkCompanyName = companyName
    if (consortiumCompanyId) {
      const { data: consortiumRow } = await supabaseUser
        .from('bid_consortium_companies')
        .select('company_name')
        .eq('id', consortiumCompanyId)
        .eq('bid_application_id', id)
        .maybeSingle()

      if ((consortiumRow as { company_name?: string } | null)?.company_name) {
        watermarkCompanyName = (consortiumRow as { company_name: string }).company_name
      }
    }
    
    // Sanitize company name for folder name (remove special chars, limit length)
    const sanitizedCompanyName = companyName
      .replace(/[^a-zA-Z0-9\s]/g, '') // Remove special characters
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .substring(0, 50) // Limit to 50 characters
      .toLowerCase()
    
    // Generate unique filename
    const timestamp = Date.now()
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
    const fileName = `${timestamp}_${sanitizedName}`
    const companyFolder = consortiumCompanyId ? `_${consortiumCompanyId}` : ''
    const folderName = `${sanitizedCompanyName}_${user.id}`
    const filePath = `${folderName}/${id}/${documentType}${companyFolder}/${fileName}`

    // Convert to buffer for upload
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Watermark before upload so only the watermarked copy is ever stored.
    // Reject on failure to keep the "all stored PDFs are watermarked" guarantee.
    let uploadBuffer: Buffer
    try {
      uploadBuffer = await watermarkPdf(buffer, watermarkCompanyName)
    } catch (e) {
      console.error('Watermarking failed:', e)
      return NextResponse.json(
        { error: 'Could not process this PDF. Please upload a valid, unprotected PDF.' },
        { status: 400 }
      )
    }

    // Upload to Supabase Storage
    const { error: uploadError } = await supabaseUser.storage
      .from('bid-submissions')
      .upload(filePath, uploadBuffer, {
        cacheControl: '3600',
        upsert: true,
        contentType: 'application/pdf'
      })

    if (uploadError) {
      console.error('Error uploading file:', uploadError)
      return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 })
    }

    // Get the file URL
    const { data: urlData } = supabaseUser.storage
      .from('bid-submissions')
      .getPublicUrl(filePath)

    // Check if this document type allows multiple files
    // Financial report allows 5 files (stored as financial_report_1, financial_report_2, etc.)
    // So we should NOT delete existing ones
    const isFinancialReport = documentType.startsWith('financial_report')
    const multipleFilesTypes = ['financial_report'] // Base types that allow multiple files
    const allowsMultipleFiles = multipleFilesTypes.some(baseType => documentType.startsWith(baseType)) || isFinancialReport

    // Only delete existing documents if this is NOT a multiple file type
    // For multiple file types, we want to keep all existing files and add the new one
    if (!allowsMultipleFiles) {
      // Delete existing document of same type for this company (if replacing)
      let deleteQuery = supabaseUser
        .from('bid_documents')
        .delete()
        .eq('bid_application_id', id)
        .eq('document_type', documentType)

      if (consortiumCompanyId) {
        deleteQuery = deleteQuery.eq('consortium_company_id', consortiumCompanyId)
      } else {
        deleteQuery = deleteQuery.is('consortium_company_id', null)
      }
      await deleteQuery
    }

    // Insert document record (truncate string fields to fit typical varchar(50) columns)
    const maxLen = 50
    const trunc = (s: string | null | undefined) =>
      s == null ? null : String(s).length > maxLen ? String(s).slice(0, maxLen) : String(s)

    const { data: docData, error: insertError } = await supabaseUser
      .from('bid_documents')
      .insert({
        bid_application_id: id,
        document_type: trunc(documentType),
        document_label: documentLabel != null && documentLabel !== '' ? trunc(documentLabel) : null,
        consortium_company_id: consortiumCompanyId || null,
        file_url: urlData.publicUrl,
        file_name: trunc(file.name),
        file_size: uploadBuffer.length,
        file_type: 'application/pdf'
      })
      .select()
      .single()

    if (insertError) {
      console.error('Error inserting document record:', insertError)
      return NextResponse.json({ error: 'Failed to save document record' }, { status: 500 })
    }

    return NextResponse.json(docData, { status: 201 })
  } catch (error) {
    console.error('Error in POST /api/bid-applications/[id]/documents:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// DELETE /api/bid-applications/[id]/documents?documentId=xxx - Delete document
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, token } = await getUserAndToken(request)

    if (!user || !token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabaseUser = createServerSupabaseClient(token)
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const documentId = searchParams.get('documentId')

    if (!documentId) {
      return NextResponse.json({ error: 'documentId is required' }, { status: 400 })
    }

    // Get application (RLS sees user via token)
    const { data: app } = await supabaseUser
      .from('bid_applications')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!app) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 })
    }

    if ((app as any).status !== 'draft') {
      return NextResponse.json({
        error: 'Cannot delete documents from submitted application'
      }, { status: 403 })
    }

    // Get document
    const { data: doc } = await supabaseUser
      .from('bid_documents')
      .select('*')
      .eq('id', documentId)
      .eq('bid_application_id', id)
      .maybeSingle()

    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    // Delete from storage
    try {
      const url = new URL((doc as any).file_url)
      const pathParts = url.pathname.split('/storage/v1/object/public/bid-submissions/')
      if (pathParts[1]) {
        await supabaseUser.storage
          .from('bid-submissions')
          .remove([decodeURIComponent(pathParts[1])])
      }
    } catch (e) {
      console.error('Error deleting file from storage:', e)
    }

    // Delete record
    const { error: deleteError } = await supabaseUser
      .from('bid_documents')
      .delete()
      .eq('id', documentId)

    if (deleteError) {
      console.error('Error deleting document:', deleteError)
      return NextResponse.json({ error: 'Failed to delete document' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in DELETE /api/bid-applications/[id]/documents:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

