'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '../../lib/auth'
import { supabase } from '../../lib/supabase'
import BiddingPortalLayout from '../../components/BiddingPortalLayout'
import { generatePaymentReceipt, PaymentReceiptData } from '../../lib/receipt-generator'
import { 
  Building2, Users, FileText, Upload, CheckCircle, AlertCircle, 
  Plus, Trash2, CreditCard, Wallet, ChevronRight, ChevronLeft,
  Save, Send, Clock, Download, X, Loader2, MapPin, Info, Lock, Receipt
} from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card'
import { Badge } from '../../components/ui/badge'
import { use } from 'react'


// Document types configuration
type DocumentTypeConfig = {
  key: string
  label: string
  required: boolean
  perCompany: boolean
  section: string
  multipleFiles?: boolean
  maxFiles?: number
}

const DOCUMENT_TYPES: Record<string, DocumentTypeConfig> = {
  annexure_a: {
    key: 'annexure_a',
    label: 'Map of Block (Annexure A)',
    required: true,
    perCompany: false,
    section: 'annexures'
  },
  annexure_b: {
    key: 'annexure_b',
    label: 'Application on the prescribed form (Annexure B)',
    required: true,
    perCompany: false,
    section: 'annexures'
  },
  annexure_c: {
    key: 'annexure_c',
    label: 'Particulars to be furnished by applicants (Annexure C)',
    required: true,
    perCompany: true,
    section: 'annexures'
  },
  annexure_d: {
    key: 'annexure_d',
    label: 'Work Program (Annexure D)',
    required: true,
    perCompany: false,
    section: 'annexures'
  },
  annexure_f: {
    key: 'annexure_f',
    label: 'Unconditional undertaking (Annexure F)',
    required: true,
    perCompany: false,
    section: 'annexures'
  },
  annexure_g: {
    key: 'annexure_g',
    label: 'Annexure G',
    required: true,
    perCompany: false,
    section: 'annexures'
  },
  annexure_h: {
    key: 'annexure_h',
    label: 'Annexure H',
    required: true,
    perCompany: false,
    section: 'annexures'
  },
  annexure_i: {
    key: 'annexure_i',
    label: 'Pakistan Offshore Petroleum Rules, 2023 (Annexure I)',
    required: true,
    perCompany: false,
    section: 'annexures'
  },
  annexure_j: {
    key: 'annexure_j',
    label: 'Pakistan Petroleum Policy 2012 (Annexure J)',
    required: true,
    perCompany: false,
    section: 'annexures'
  },
  juridical_status: {
    key: 'juridical_status',
    label: 'Evidence of juridical status of the company',
    required: true,
    perCompany: false,
    section: 'company'
  },
  articles_of_association: {
    key: 'articles_of_association',
    label: "Copy of company's statute and Articles of Association",
    required: true,
    perCompany: false,
    section: 'company'
  },
  organizational_structure: {
    key: 'organizational_structure',
    label: "Description of company's organizational structure",
    required: true,
    perCompany: true,
    section: 'company'
  },
  operator_experience: {
    key: 'operator_experience',
    label: 'Experience as Operator',
    required: true,
    perCompany: false,
    section: 'company'
  },
  financial_report: {
    key: 'financial_report',
    label: 'Financial Report of last 5 years',
    required: true,
    perCompany: true, // Each consortium company needs to upload 5 years of financial reports
    section: 'financials',
    multipleFiles: true,
    maxFiles: 5
  }
}

type DocumentTypeKey = keyof typeof DOCUMENT_TYPES

interface BidApplication {
  id: string
  user_id: string
  area_id: string
  primary_applicant_name: string
  submission_type: 'single' | 'consortium'
  application_fee_amount: number
  application_fee_status: 'pending' | 'paid' | 'verified' | 'failed'
  payment_method: 'online' | 'bank_challan' | null
  payment_transaction_id: string | null
  payment_proof_url: string | null
  bank_name: string | null
  challan_number: string | null
  challan_date: string | null
  payment_paid_at: string | null
  payment_raw_payload?: any // JSONB field containing PayFast response
  work_units?: number | null
  work_units_encrypted?: string | null // Encrypted work units
  work_units_encrypted_at?: string | null // Timestamp when work units were encrypted
  status: 'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected'
  rejection_reason: string | null
  submitted_at: string | null
  deadline: string | null
  created_at: string
  updated_at: string
  consortium_companies?: Array<{
    id: string
    company_name: string
    sort_order: number
    work_unit_percentage?: number | null
  }>
  documents?: Array<{
    id: string
    document_type: string
    document_label: string | null
    consortium_company_id: string | null
    file_url: string
    file_name: string
    file_size: number | null
    file_type: string | null
    created_at?: string
  }>
  area?: {
    id: string
    name: string
    code: string
    status: string
    bid_submission_deadline: string | null
  }
}

async function getAuthToken(): Promise<string> {
  // First try to get from current session
  const { data: { session }, error: sessionError } = await supabase.auth.getSession()
  
  if (sessionError) {
    console.error('Error getting session:', sessionError)
    throw new Error('Session error. Please sign in again.')
  }
  
  if (session?.access_token) {
    // Check if token is expiring soon (within 1 minute)
    const expiresAt = session.expires_at ? session.expires_at * 1000 : 0
    const isExpiringSoon = expiresAt > 0 && expiresAt < Date.now() + 60_000
    
    if (isExpiringSoon) {
      // Refresh the session
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession()
      if (refreshError || !refreshData?.session?.access_token) {
        throw new Error('Session expired. Please sign in again.')
      }
      return refreshData.session.access_token
    }
    
    return session.access_token
  }
  
  // If no session, try to refresh
  const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession()
  if (refreshError || !refreshData?.session?.access_token) {
    throw new Error('Session expired. Please sign in again.')
  }
  
  return refreshData.session.access_token
}

export default function BidSubmissionPage({ 
  params 
}: { 
  params: Promise<{ areaId: string }> 
}) {
  const resolvedParams = use(params)
  const areaId = resolvedParams.areaId
  
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, loading: authLoading, userProfile } = useAuth()
  
  const [currentStep, setCurrentStep] = useState(1)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [portalEnabled, setPortalEnabled] = useState<boolean | null>(null)
  const [bidSubmissionClosingDate, setBidSubmissionClosingDate] = useState<Date | null>(null)
  
  const [application, setApplication] = useState<BidApplication | null>(null)
  const [areaDetails, setAreaDetails] = useState<any>(null)
  
  // Step 1 form state
  const [primaryApplicantName, setPrimaryApplicantName] = useState('')
  const [submissionType, setSubmissionType] = useState<'single' | 'consortium'>('single')
  const [userCompanyName, setUserCompanyName] = useState<string>('')
  const [consortiumCompanies, setConsortiumCompanies] = useState<string[]>([''])
  
  // Step 2 payment state
  const [paymentMethod, setPaymentMethod] = useState<'online' | 'bank_challan' | null>(null)
  const [bankName, setBankName] = useState('')
  const [challanNumber, setChallanNumber] = useState('')
  const [challanDate, setChallanDate] = useState('')
  const [paymentProofFile, setPaymentProofFile] = useState<File | null>(null)
  const [paymentProofAgreementChecked, setPaymentProofAgreementChecked] = useState(false)
  const [uploadingProof, setUploadingProof] = useState(false)
  
  // Step 3 documents state
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null)
  const [downloadingReceipt, setDownloadingReceipt] = useState(false)
  
  // Step 4 work unit state
  const [workUnit, setWorkUnit] = useState('')
  const [workUnitError, setWorkUnitError] = useState('')
  const [consortiumPercentages, setConsortiumPercentages] = useState<Record<string, string>>({})
  const [percentageError, setPercentageError] = useState('')
  const [companyDropdowns, setCompanyDropdowns] = useState<Record<number, boolean>>({})
  const [filteredCompanies, setFilteredCompanies] = useState<Record<number, string[]>>({})
  const [companyNames, setCompanyNames] = useState<string[]>([])
  const companyInputRefs = useRef<Record<number, HTMLInputElement | null>>({})
  const companyDropdownRefs = useRef<Record<number, HTMLDivElement | null>>({})

  // Fetch companies from database
  useEffect(() => {
    const fetchCompanies = async () => {
      try {
        const response = await fetch('/api/companies')
        if (response.ok) {
          const companies = await response.json()
          setCompanyNames(companies)
        } else {
          console.error('Failed to fetch companies')
          setCompanyNames([])
        }
      } catch (error) {
        console.error('Error fetching companies:', error)
        setCompanyNames([])
      }
    }

    fetchCompanies()
  }, [])

  // Handle company name input change with filtering
  const handleCompanyNameChange = (index: number, value: string) => {
    // Lock the first company (user's own company) from edits
    if (index === 0) return
    
    const updated = [...consortiumCompanies]
    updated[index] = value
    setConsortiumCompanies(updated)
    
    if (value.trim()) {
      const filtered = companyNames.filter(company =>
        company.toLowerCase().includes(value.toLowerCase())
      )
      setFilteredCompanies(prev => ({ ...prev, [index]: filtered }))
      setCompanyDropdowns(prev => ({ ...prev, [index]: filtered.length > 0 }))
    } else {
      setFilteredCompanies(prev => ({ ...prev, [index]: companyNames }))
      setCompanyDropdowns(prev => ({ ...prev, [index]: true }))
    }
  }

  // Handle company name focus
  const handleCompanyNameFocus = (index: number) => {
    setFilteredCompanies(prev => ({ ...prev, [index]: companyNames }))
    setCompanyDropdowns(prev => ({ ...prev, [index]: true }))
  }

  // Handle company selection from dropdown
  const handleCompanySelect = (index: number, company: string) => {
    // Lock the first company (user's own company) from edits
    if (index === 0) return
    
    const updated = [...consortiumCompanies]
    updated[index] = company
    setConsortiumCompanies(updated)
    setCompanyDropdowns(prev => ({ ...prev, [index]: false }))
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      Object.keys(companyDropdownRefs.current).forEach((key) => {
        const ref = companyDropdownRefs.current[Number(key)]
        if (ref && !ref.contains(event.target as Node)) {
          const inputRef = companyInputRefs.current[Number(key)]
          if (inputRef && !inputRef.contains(event.target as Node)) {
            setCompanyDropdowns(prev => ({ ...prev, [Number(key)]: false }))
          }
        }
      })
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  // Check if bidding portal is enabled - using cached status
  useEffect(() => {
    let isMounted = true
    
    const checkPortalStatus = async () => {
      try {
        const { getBiddingPortalStatus } = await import('../../lib/bidding-portal-cache')
        const enabled = await getBiddingPortalStatus()
        
        if (isMounted) {
          setPortalEnabled(enabled)
          
          if (!enabled) {
            setLoading(false)
            return
          }
        }
      } catch (err) {
        console.error('Error checking portal status:', err)
        if (isMounted) {
        setPortalEnabled(true) // Default to enabled if check fails
        }
      }
    }

    checkPortalStatus()
    
    return () => {
      isMounted = false
    }
  }, [])

  // Update userCompanyName when userProfile changes
  useEffect(() => {
    if (userProfile?.company_name && !userCompanyName) {
      setUserCompanyName(userProfile.company_name)
    }
  }, [userProfile, userCompanyName])

  // Initialize consortium companies with user's company when switching to consortium type
  useEffect(() => {
    if (submissionType === 'consortium') {
      const companyName = userCompanyName || userProfile?.company_name || ''
      if (companyName && (consortiumCompanies.length === 0 || consortiumCompanies[0] === '' || consortiumCompanies[0] !== companyName)) {
        // If consortium companies is empty or first field is empty or different, set to user's company
        if (consortiumCompanies.length === 0) {
          setConsortiumCompanies([companyName])
        } else {
          const updated = [...consortiumCompanies]
          updated[0] = companyName
          setConsortiumCompanies(updated)
        }
      }
    }
  }, [submissionType, userCompanyName, userProfile?.company_name])

  // Check for payment return message
  useEffect(() => {
    const paymentStatus = searchParams.get('payment')
    const message = searchParams.get('message')
    
    if (paymentStatus === 'success') {
      setSuccessMessage('Payment successful! You can now proceed to upload documents.')
      setCurrentStep(3)
    } else if (paymentStatus === 'failed') {
      setError(message || 'Payment failed. Please try again.')
    }
  }, [searchParams])

  // Refresh application data without showing full loader
  const refreshApplication = useCallback(async (appId?: string) => {
    if (!user) return
    
    const applicationId = appId || application?.id
    if (!applicationId) return
    
    try {
      const token = await getAuthToken()
      
      const response = await fetch(`/api/bid-applications/${applicationId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (!response.ok) {
        console.error('Failed to refresh application')
        return
      }

      const updatedApp = await response.json()
      setApplication(updatedApp)
    } catch (err) {
      console.error('Error refreshing application:', err)
    }
  }, [user, application?.id])

  // Load application
  const loadApplication = useCallback(async () => {
    if (!user) return
    
    try {
      setLoading(true)
      let token: string
      try {
        token = await getAuthToken()
      } catch (tokenError: any) {
        console.error('Error getting auth token:', tokenError)
        setError('Session expired. Please sign in again.')
        router.push(`/login?redirect=/bid-submission/${areaId}`)
        setLoading(false)
        return
      }
      
      if (!token) {
        setError('Authentication required. Please sign in.')
        router.push(`/login?redirect=/bid-submission/${areaId}`)
        setLoading(false)
        return
      }
      
      // Load company name from user profile if not already loaded
      let companyName = userProfile?.company_name || ''
      
      if (!companyName) {
        // Fetch from database if not in userProfile
        const { data: profile, error: profileError } = await supabase
          .from('user_profiles')
          .select('company_name')
          .eq('id', user.id)
          .single()
        
        if (!profileError && profile?.company_name) {
          companyName = profile.company_name
        }
      }
      
      if (!companyName) {
        setError('Company name not found in your profile. Please complete your profile first.')
        setLoading(false)
        return
      }
      
      // Store user's company name for use throughout component
      setUserCompanyName(companyName)
      
      // First, get area details
      const { data: area, error: areaError } = await supabase
        .from('areas')
        .select(`
          id, name, code, status, bid_submission_deadline, price, grid_area,
          zones!inner(
            name,
            blocks!inner(name, type)
          )
        `)
        .eq('id', areaId)
        .maybeSingle()

      if (areaError || !area) {
        setError('Block not found')
        setLoading(false)
        return
      }

      setAreaDetails(area)

      // Check if area is open for bidding
      if (area.status !== 'Open') {
        setError('Bidding is not open for this block')
        setLoading(false)
        return
      }

      // Check deadline
      if (area.bid_submission_deadline) {
        const deadline = new Date(area.bid_submission_deadline)
        if (deadline < new Date()) {
          setError('Submission deadline has passed')
          setLoading(false)
          return
        }
      }

      // Fetch and check bid submission closing date
      try {
        const closingDateResponse = await fetch('/api/bidding-portal/closing-date', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        })
        
        if (closingDateResponse.ok) {
          const closingDateData = await closingDateResponse.json()
          if (closingDateData.bid_submission_closing_date) {
            const closingDate = new Date(closingDateData.bid_submission_closing_date)
            setBidSubmissionClosingDate(closingDate)
            
            if (closingDate < new Date()) {
              setError('Bid submission deadline has passed. No further submissions are accepted.')
              setLoading(false)
              return
            }
          }
        }
      } catch (closingDateError) {
        console.error('Error fetching closing date:', closingDateError)
        // Don't block the page if we can't fetch the closing date, but log it
      }

      // Check if user has purchased this area
      const { data: purchase } = await supabase
        .from('area_downloads')
        .select('id')
        .eq('user_id', user.id)
        .eq('area_id', areaId)
        .eq('payment_status', 'completed')
        .maybeSingle()

      if (!purchase) {
        setError('You must purchase the bidding document first before applying')
        setLoading(false)
        return
      }

      // Create or get existing application
      const response = await fetch('/api/bid-applications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ area_id: areaId })
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Unknown error' }))
        
        // Handle unauthorized errors
        if (response.status === 401) {
          setError('Your session has expired. Please sign in again.')
          router.push(`/login?redirect=/bid-submission/${areaId}`)
          setLoading(false)
          return
        }
        
        if (response.status === 409 && err.application) {
          // Already submitted
          setApplication(err.application)
          setError('You have already submitted an application for this block')
        } else {
          throw new Error(err.error || 'Failed to load application')
        }
        setLoading(false)
        return
      }

      const app = await response.json()
      setApplication(app)
      
      // Populate form state - use company name from profile
      setPrimaryApplicantName(app.primary_applicant_name || companyName)
      
      // Load submission type
      if (app.submission_type) {
        setSubmissionType(app.submission_type)
      }
      
      if (app.consortium_companies && app.consortium_companies.length > 0) {
        // Ensure first company is always the user's company
        const companies = app.consortium_companies.map((c: any) => c.company_name)
        if (companies[0] !== companyName) {
          // Replace first company with user's company if it's different
          companies[0] = companyName
        }
        setConsortiumCompanies(companies)
      } else if (app.submission_type === 'consortium') {
        // If consortium but no companies, initialize with user's company as first field
        setConsortiumCompanies([companyName])
      }
      
      if (app.payment_method) {
        setPaymentMethod(app.payment_method)
        setBankName(app.bank_name || '')
        setChallanNumber(app.challan_number || '')
        setChallanDate(app.challan_date || '')
      }

      // Load work unit if exists (note: work_units is null when encrypted, use work_units_encrypted_at to check)
      // Stored value is the TOTAL (100 + offered * grid_area), so reverse-derive the offered value to prefill the input
      if (app.work_units && Number(area?.grid_area)) {
        setWorkUnit(((app.work_units - 100) / Number(area.grid_area)).toString())
      } else if (app.work_units) {
        setWorkUnit(app.work_units.toString())
      } else if (app.work_units_encrypted_at) {
        // Work units are encrypted - set placeholder value to indicate they were saved
        setWorkUnit('encrypted')
      }

      // Load consortium percentages if exists
      if (app.consortium_companies && app.consortium_companies.length > 0) {
        const percentages: Record<string, string> = {}
        app.consortium_companies.forEach((company: any, index: number) => {
          // Use sort_order to determine the key, or fall back to index
          const companyIndex = company.sort_order !== undefined ? company.sort_order : index
          const companyKey = `company_${companyIndex}`
          if (company.work_unit_percentage !== null && company.work_unit_percentage !== undefined) {
            percentages[companyKey] = company.work_unit_percentage.toString()
          }
        })
        setConsortiumPercentages(percentages)
      }

      // Determine current step based on progress
      // IMPORTANT: Use work_units_encrypted_at to check if work units are saved (work_units is NULL when encrypted)
      const hasEncryptedWorkUnits = !!app.work_units_encrypted_at
      
      if (app.status === 'submitted' || app.status === 'under_review' || app.status === 'approved') {
        setCurrentStep(5) // Review step
      } else if (hasEncryptedWorkUnits) {
        // Work units are encrypted/saved - go to documents step or review
        // Calculate document progress from the loaded app object
        let required = 0
        let uploaded = 0

        Object.values(DOCUMENT_TYPES).forEach(docType => {
          if (!docType.required) return

          if (docType.perCompany && app.submission_type === 'consortium') {
            const companies = app.consortium_companies || []
            
            // For per-company documents with multiple files (like financial reports)
            if (docType.multipleFiles) {
              const maxFiles = docType.maxFiles || 5
              required += Math.max(companies.length, 1) * maxFiles
              
              companies.forEach((company: any) => {
                const docs = (app.documents || []).filter((d: any) => {
                  const baseType = docType.key === 'financial_report' ? 'financial_report' : docType.key
                  const matchesType = d.document_type === baseType || 
                                     (baseType === 'financial_report' && d.document_type?.startsWith('financial_report_'))
                  return matchesType && d.consortium_company_id === company.id
                })
                uploaded += docs.length
              })
            } else {
              required += Math.max(companies.length, 1)
              companies.forEach((company: any) => {
                const hasDoc = (app.documents || []).some((d: any) => 
                  d.document_type === docType.key && d.consortium_company_id === company.id
                )
                if (hasDoc) uploaded++
              })
            }
          } else if (docType.multipleFiles) {
            const maxFiles = docType.maxFiles || 5
            required += maxFiles
            
            const baseType = docType.key === 'financial_report' ? 'financial_report' : docType.key
            const docs = (app.documents || []).filter((d: any) => 
              d.document_type === baseType || 
              (baseType === 'financial_report' && d.document_type?.startsWith('financial_report_'))
            )
            uploaded += docs.length
          } else {
            required++
            const hasDoc = (app.documents || []).some((d: any) => 
              d.document_type === docType.key && !d.consortium_company_id
            )
            if (hasDoc) uploaded++
          }
        })

        const docProgressPercentage = required > 0 ? Math.round((uploaded / required) * 100) : 0
        
        if (docProgressPercentage === 100) {
          // All documents uploaded, go to review
          setCurrentStep(5)
        } else {
          // Work units saved but documents incomplete, go to documents step
          setCurrentStep(4)
        }
      } else if (app.application_fee_status === 'paid' || app.application_fee_status === 'verified') {
        // Allow user to proceed to Work Unit step
        setCurrentStep(3) // Work Unit step
      } else if (app.primary_applicant_name) {
        setCurrentStep(2) // Payment step
      }
      
    } catch (err: any) {
      console.error('Error loading application:', err)
      
      // Handle unauthorized/authentication errors
      if (err.message?.includes('Unauthorized') || 
          err.message?.includes('Session expired') || 
          err.message?.includes('authentication') ||
          err.message?.includes('Session error')) {
        setError('Your session has expired. Please sign in again.')
        router.push(`/login?redirect=/bid-submission/${areaId}`)
      } else {
        setError(err.message || 'Failed to load application')
      }
    } finally {
      setLoading(false)
    }
  }, [user, areaId, userProfile, router])

  useEffect(() => {
    if (!authLoading && !user) {
      router.push(`/login?redirect=/bid-submission/${areaId}`)
      return
    }
    
    if (user) {
      loadApplication()
    }
  }, [user, authLoading, areaId, router, loadApplication])

  // Save Step 1
  const saveStep1 = async () => {
    if (!application) return
    
    if (!primaryApplicantName.trim()) {
      setError('Primary applicant name is required')
      return
    }

    try {
      setSaving(true)
      setError('')
      const token = await getAuthToken()

      const response = await fetch(`/api/bid-applications/${application.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          primary_applicant_name: primaryApplicantName,
          submission_type: submissionType
        })
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Failed to save')
      }

      const updated = await response.json()
      setApplication(updated)
      setSuccessMessage('Profile information saved!')
      setTimeout(() => setSuccessMessage(''), 3000)
      setCurrentStep(2)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // Upload payment proof
  const uploadPaymentProof = async (file: File): Promise<string> => {
    if (!application) throw new Error('No application')
    
    const token = await getAuthToken()
    const formData = new FormData()
    formData.append('file', file)

    const response = await fetch(`/api/bid-applications/${application.id}/payment/upload-proof`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    })

    if (!response.ok) {
      const err = await response.json()
      throw new Error(err.error || 'Failed to upload')
    }

    const result = await response.json()
    return result.file_url
  }

  // Save Step 2 (Bank Challan)
  const saveStep2Challan = async () => {
    if (!application) return
    
    if (!bankName.trim() || !challanNumber.trim() || !challanDate) {
      setError('Please fill all payment details')
      return
    }
    if (!paymentProofAgreementChecked) {
      setError('Please confirm the payment proof agreement to continue')
      return
    }

    try {
      setSaving(true)
      setError('')
      
      let proofUrl = application.payment_proof_url
      
      if (paymentProofFile) {
        setUploadingProof(true)
        proofUrl = await uploadPaymentProof(paymentProofFile)
        setUploadingProof(false)
      }

      if (!proofUrl) {
        setError('Please upload payment proof')
        setSaving(false)
        return
      }

      const token = await getAuthToken()

      const response = await fetch(`/api/bid-applications/${application.id}/payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          payment_method: 'bank_challan',
          bank_name: bankName,
          challan_number: challanNumber,
          challan_date: challanDate,
          payment_proof_url: proofUrl
        })
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Failed to save payment')
      }

      const result = await response.json()
      setApplication(result.application)
      setSuccessMessage('Payment details saved!')
      setTimeout(() => setSuccessMessage(''), 3000)
      setCurrentStep(3)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
      setUploadingProof(false)
    }
  }

  // Initiate online payment
  const initiateOnlinePayment = async () => {
    if (!application) return
    
    try {
      setSaving(true)
      setError('')
      const token = await getAuthToken()

      const response = await fetch(`/api/bid-applications/${application.id}/payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          payment_method: 'online'
        })
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Failed to initiate payment')
      }

      const data = await response.json()

      // Build and submit PayFast form
      const form = document.createElement('form')
      form.method = 'POST'
      form.action = data.actionUrl
      form.style.display = 'none'

      Object.entries(data.form).forEach(([k, v]) => {
        const input = document.createElement('input')
        input.type = 'hidden'
        input.name = k
        input.value = String(v)
        form.appendChild(input)
      })

      document.body.appendChild(form)
      form.submit()
    } catch (err: any) {
      setError(err.message)
      setSaving(false)
    }
  }

  // Upload document
  const uploadDocument = async (
    documentType: DocumentTypeKey, 
    file: File, 
    consortiumCompanyId?: string,
    replaceIndex?: number // For multiple files, specify which index to replace
  ) => {
    if (!application) return
    
    const docTypeConfig = DOCUMENT_TYPES[documentType]
    
    // Determine the actual document type to use (with number for financial_report)
    let actualDocumentType: string = documentType
    
    // For financial_report, determine which number to use
    if (documentType === 'financial_report' && docTypeConfig.multipleFiles) {
      const existingDocs = getUploadedDocument(documentType, consortiumCompanyId)
      if (existingDocs && Array.isArray(existingDocs)) {
        // Check existing numbered types to find the next available number
        const existingNumbers = existingDocs
          .map(d => {
            const match = d.document_type?.match(/financial_report_(\d+)/)
            return match ? parseInt(match[1]) : null
          })
          .filter(n => n !== null) as number[]
        
        // Find the next available number (1-5)
        let nextNumber = 1
        for (let i = 1; i <= (docTypeConfig.maxFiles || 5); i++) {
          if (!existingNumbers.includes(i)) {
            nextNumber = i
            break
          }
        }
        
        // If replacing a specific index, use that number
        if (replaceIndex !== undefined && existingDocs[replaceIndex]) {
          const match = existingDocs[replaceIndex].document_type?.match(/financial_report_(\d+)/)
          nextNumber = match ? parseInt(match[1]) : replaceIndex + 1
          await deleteDocument(existingDocs[replaceIndex].id)
        }
        
        // Check if limit reached
        if (replaceIndex === undefined && existingDocs.length >= (docTypeConfig.maxFiles || 5)) {
          setError(`Maximum ${docTypeConfig.maxFiles || 5} files allowed for ${docTypeConfig.label}`)
          return
        }
        
        actualDocumentType = `financial_report_${nextNumber}`
      } else {
        // No existing files, start with 1
        actualDocumentType = 'financial_report_1'
      }
    } else if (docTypeConfig.multipleFiles) {
      // For other multiple file types, check limit
      const existingDocs = getUploadedDocument(documentType, consortiumCompanyId)
      if (existingDocs && Array.isArray(existingDocs)) {
        if (replaceIndex === undefined && existingDocs.length >= (docTypeConfig.maxFiles || 5)) {
          setError(`Maximum ${docTypeConfig.maxFiles || 5} files allowed for ${docTypeConfig.label}`)
          return
        }
        if (replaceIndex !== undefined && existingDocs[replaceIndex]) {
          await deleteDocument(existingDocs[replaceIndex].id)
        }
      }
    }
    
    const uploadKey = consortiumCompanyId 
      ? `${documentType}_${consortiumCompanyId}` 
      : (docTypeConfig.multipleFiles && replaceIndex !== undefined)
        ? `${documentType}_year${replaceIndex + 1}`
        : documentType
    
    try {
      setUploadingDoc(uploadKey)
      setError('')
      const token = await getAuthToken()

      const formData = new FormData()
      formData.append('file', file)
      formData.append('document_type', actualDocumentType) // Use the numbered type for financial_report
      formData.append('document_label', docTypeConfig.label)
      if (consortiumCompanyId) {
        formData.append('consortium_company_id', consortiumCompanyId)
      }

      const response = await fetch(`/api/bid-applications/${application.id}/documents`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Failed to upload')
      }

      const uploadedDoc = await response.json()
      
      // Optimistically update the UI
      if (application) {
        // For multiple file types, don't remove old documents, just add new one
        if (docTypeConfig.multipleFiles) {
          const updatedDocuments = [...(application.documents || []), uploadedDoc]
          setApplication({
            ...application,
            documents: updatedDocuments
          })
        } else {
          // Remove old document of same type if exists (single file types)
          const updatedDocuments = (application.documents || []).filter(
            d => !(d.document_type === documentType && 
                   (consortiumCompanyId ? d.consortium_company_id === consortiumCompanyId : !d.consortium_company_id))
          )
          
          // Add new document
          updatedDocuments.push(uploadedDoc)
          
          // Update application state immediately
          setApplication({
            ...application,
            documents: updatedDocuments
          })
        }
      }
      
      // Refresh in background to ensure sync (without showing loader)
      refreshApplication().catch(err => console.error('Background refresh failed:', err))
      
      setSuccessMessage('Document uploaded successfully!')
      setTimeout(() => setSuccessMessage(''), 3000)
    } catch (err: any) {
      setError(err.message)
    } finally {
      // Don't clear upload state here - let the batch handler manage it
      // Only clear if this is a single file upload (not part of batch)
      const isBatchUpload = uploadingDoc?.includes('_batch') || uploadingDoc?.includes('_file_')
      if (!isBatchUpload) {
        setUploadingDoc(null)
      }
    }
  }

  // Delete document
  const deleteDocument = async (documentId: string) => {
    if (!application) return
    
    if (!confirm('Are you sure you want to delete this document?')) return
    
    try {
      setError('')
      const token = await getAuthToken()

      const response = await fetch(
        `/api/bid-applications/${application.id}/documents?documentId=${documentId}`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      )

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Failed to delete')
      }

      // Optimistically update the UI
      if (application) {
        const updatedDocuments = (application.documents || []).filter(d => d.id !== documentId)
        setApplication({
          ...application,
          documents: updatedDocuments
        })
      }
      
      // Refresh in background to ensure sync (without showing loader)
      refreshApplication().catch(err => console.error('Background refresh failed:', err))
    } catch (err: any) {
      setError(err.message)
    }
  }

  // Submit application
  const submitApplication = async () => {
    if (!application) return
    
    // Check closing date before allowing submission
    if (bidSubmissionClosingDate && new Date() > bidSubmissionClosingDate) {
      setError('Bid submission deadline has passed. No further submissions are accepted.')
      return
    }
    
    if (!confirm('Are you sure you want to submit? You will not be able to make changes after submission.')) {
      return
    }
    
    try {
      setSubmitting(true)
      setError('')
      const token = await getAuthToken()

      const response = await fetch(`/api/bid-applications/${application.id}/submit`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.errors?.join(', ') || result.error || 'Failed to submit')
      }

      setApplication(result.application)
      setSuccessMessage('Application submitted successfully!')
      setCurrentStep(4)
      
      // Refresh application to ensure all documents are loaded
      await refreshApplication(result.application.id)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  // Helper: Check if document is uploaded
  const isDocumentUploaded = (docType: string, consortiumCompanyId?: string): boolean => {
    if (!application?.documents) return false
    
    const docTypeConfig = DOCUMENT_TYPES[docType as DocumentTypeKey]
    // For financial_report, also check numbered variants
    const baseType = docType === 'financial_report' ? 'financial_report' : docType
    const matchingDocs = application.documents.filter(d => {
      const matchesType = d.document_type === baseType || 
                         (baseType === 'financial_report' && d.document_type?.startsWith('financial_report_'))
      const matchesCompany = consortiumCompanyId 
        ? d.consortium_company_id === consortiumCompanyId 
        : !d.consortium_company_id
      return matchesType && matchesCompany
    })
    
    // For multiple file types, need at least 1 file
    if (docTypeConfig?.multipleFiles) {
      return matchingDocs.length > 0
    }
    
    return matchingDocs.length > 0
  }

  // Helper: Get uploaded document(s)
  const getUploadedDocument = (docType: string, consortiumCompanyId?: string) => {
    if (!application?.documents) return null
    
    const docTypeConfig = DOCUMENT_TYPES[docType as DocumentTypeKey]
    if (docTypeConfig?.multipleFiles) {
      // For financial_report, also check for numbered variants (financial_report_1, financial_report_2, etc.)
      const baseType = docType === 'financial_report' ? 'financial_report' : docType
      const docs = application.documents.filter(d => {
        const matchesType = d.document_type === baseType || 
                           (baseType === 'financial_report' && d.document_type?.startsWith('financial_report_'))
        const matchesCompany = consortiumCompanyId 
          ? d.consortium_company_id === consortiumCompanyId 
          : !d.consortium_company_id
        return matchesType && matchesCompany
      })
      // Sort by document_type number (financial_report_1, financial_report_2, etc.) or created_at
      return docs.sort((a, b) => {
        // Extract number from document_type if it's numbered
        const getNumber = (docType: string) => {
          const match = docType.match(/_(\d+)$/)
          return match ? parseInt(match[1]) : 999
        }
        const numA = getNumber(a.document_type)
        const numB = getNumber(b.document_type)
        if (numA !== 999 || numB !== 999) {
          return numA - numB
        }
        // Fallback to created_at
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0
        return dateA - dateB
      })
    }
    
    return application.documents.find(d => 
      d.document_type === docType && 
      (consortiumCompanyId ? d.consortium_company_id === consortiumCompanyId : !d.consortium_company_id)
    )
  }

  // Calculate document progress
  const getDocumentProgress = () => {
    if (!application) return { uploaded: 0, required: 0, percentage: 0 }
    
    let required = 0
    let uploaded = 0

    Object.values(DOCUMENT_TYPES).forEach(docType => {
      if (!docType.required) return

      if (docType.perCompany && submissionType === 'consortium') {
        const companies = application.consortium_companies || []
        
        // For per-company documents with multiple files (like financial reports)
        if (docType.multipleFiles) {
          const maxFiles = docType.maxFiles || 5
          // Each company needs maxFiles (e.g., 5 financial reports each)
          required += Math.max(companies.length, 1) * maxFiles
          
          companies.forEach(company => {
            const docs = getUploadedDocument(docType.key, company.id)
            if (docs && Array.isArray(docs)) {
              uploaded += docs.length
            }
          })
        } else {
          // Single file per company
          required += Math.max(companies.length, 1)
          
          companies.forEach(company => {
            if (isDocumentUploaded(docType.key, company.id)) {
              uploaded++
            }
          })
        }
      } else if (docType.multipleFiles) {
        // For multiple file types without per-company (single company mode)
        const maxFiles = docType.maxFiles || 5
        required += maxFiles
        
        const docs = getUploadedDocument(docType.key)
        if (docs && Array.isArray(docs)) {
          uploaded += docs.length
        }
      } else {
        required++
        if (isDocumentUploaded(docType.key)) {
          uploaded++
        }
      }
    })

    return {
      uploaded,
      required,
      percentage: required > 0 ? Math.round((uploaded / required) * 100) : 0
    }
  }

  if (authLoading || loading || portalEnabled === null) {
    return (
      <BiddingPortalLayout 
        activeTab="bid-submission" 
        title="Loading..."
        showBackButton
        backHref="/bidding-portal/purchased-documents"
        backLabel="Back to Documents"
      >
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <Loader2 className="w-12 h-12 animate-spin text-teal-600 mx-auto mb-4" />
            <p className="text-gray-600">Loading application...</p>
          </div>
        </div>
      </BiddingPortalLayout>
    )
  }

  // Check if bidding portal is disabled
  if (portalEnabled === false) {
    return (
      <BiddingPortalLayout 
        activeTab="bid-submission" 
        title="Bidding Portal Locked"
        showBackButton
        backHref="/"
        backLabel="Return to Home"
      >
        <div className="flex items-center justify-center min-h-[60vh]">
          <Card className="max-w-md w-full">
            <CardContent className="p-8 text-center">
              <Lock className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Bidding Portal is Currently Locked</h2>
              <p className="text-gray-600 mb-6">
                The bidding portal is temporarily unavailable. Please check back later or contact support for assistance.
              </p>
              <Button onClick={() => router.push('/')} className="bg-teal-600 hover:bg-teal-700">
                Return to Home
              </Button>
            </CardContent>
          </Card>
        </div>
      </BiddingPortalLayout>
    )
  }

  if (error && !application) {
    return (
      <BiddingPortalLayout 
        activeTab="bid-submission" 
        title="Cannot Apply"
        showBackButton
        backHref="/bidding-portal/purchased-documents"
        backLabel="Back to Documents"
      >
        <div className="max-w-4xl mx-auto">
          <Card>
            <CardContent className="text-center py-12">
              <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Cannot Apply</h2>
              <p className="text-gray-600 mb-6">{error}</p>
              <Button onClick={() => router.push('/bidding-portal')}>
                Go to Bidding Portal
              </Button>
            </CardContent>
          </Card>
        </div>
      </BiddingPortalLayout>
    )
  }

  const steps = [
    { number: 1, title: 'Profile & Consortium', icon: Building2 },
    { number: 2, title: 'Application Fee', icon: CreditCard },
    { number: 3, title: 'Work Unit', icon: FileText },
    { number: 4, title: 'Documents', icon: FileText },
    { number: 5, title: 'Review & Submit', icon: Send }
  ]

  const isSubmitted = application?.status === 'submitted' || 
                      application?.status === 'under_review' || 
                      application?.status === 'approved'

  const docProgress = getDocumentProgress()

  // Work Units = 100 + (offered x grid_area). User enters the offered value; we compute + save the total.
  const gridArea = Number(areaDetails?.grid_area) || 0
  const offeredNum = workUnit === '' ? NaN : Number(workUnit)
  const totalWorkUnits = !isNaN(offeredNum) ? 100 + offeredNum * gridArea : 0

  const deadlineText = application?.deadline 
    ? `Deadline: ${new Date(application.deadline).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })}`
    : undefined

  return (
    <BiddingPortalLayout 
      activeTab="bid-submission" 
      title={`Bid Submission - ${areaDetails?.name || ''}`}
      subtitle={`${areaDetails?.zones?.blocks?.name || ''} • ${areaDetails?.code || ''} ${deadlineText ? `• ${deadlineText}` : ''}`}
      showBackButton
      backHref="/bidding-portal/purchased-documents"
      backLabel="Back to Documents"
    >

      {/* Progress Steps */}
      <div className="bg-white border-b shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            {steps.map((step, index) => {
              const Icon = step.icon
              const isActive = currentStep === step.number
              const isCompleted = currentStep > step.number || isSubmitted
              
              return (
                <div key={step.number} className="flex items-center">
                  <div 
                    className={`flex items-center cursor-pointer ${
                      isActive ? 'text-teal-600' : isCompleted ? 'text-green-600' : 'text-gray-400'
                    }`}
                    onClick={() => {
                      if (!isSubmitted && step.number < currentStep) {
                        // Prevent going back to Work Unit step (step 3) if work units are already encrypted
                        if (step.number === 3 && application?.work_units_encrypted_at) {
                          // Work units are encrypted/saved, skip to documents step instead
                          setCurrentStep(4)
                        } else {
                          setCurrentStep(step.number)
                        }
                      }
                    }}
                  >
                    <div className={`
                      w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors
                      ${isActive ? 'border-teal-600 bg-teal-50' : 
                        isCompleted ? 'border-green-600 bg-green-50' : 'border-gray-300'}
                    `}>
                      {isCompleted && !isActive ? (
                        <CheckCircle className="w-5 h-5" />
                      ) : (
                        <Icon className="w-5 h-5" />
                      )}
                    </div>
                    <span className={`ml-2 font-medium hidden sm:inline ${
                      isActive ? 'text-teal-600' : isCompleted ? 'text-green-600' : 'text-gray-400'
                    }`}>
                      {step.title}
                    </span>
                  </div>
                  {index < steps.length - 1 && (
                    <div className={`w-8 sm:w-16 h-0.5 mx-2 ${
                      currentStep > step.number || isSubmitted ? 'bg-green-600' : 'bg-gray-300'
                    }`} />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Messages */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-start">
            <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 mr-3 flex-shrink-0" />
            <div>
              <p className="text-red-800">{error}</p>
            </div>
            <button onClick={() => setError('')} className="ml-auto">
              <X className="w-5 h-5 text-red-400 hover:text-red-600" />
            </button>
          </div>
        )}
        
        {successMessage && (
          <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4 flex items-start">
            <CheckCircle className="w-5 h-5 text-green-500 mt-0.5 mr-3 flex-shrink-0" />
            <p className="text-green-800">{successMessage}</p>
            <button onClick={() => setSuccessMessage('')} className="ml-auto">
              <X className="w-5 h-5 text-green-400 hover:text-green-600" />
            </button>
          </div>
        )}

        {/* Status Badge for Submitted Applications */}
        {isSubmitted && (
          <div className="mb-6">
            <Card className="border-green-200 bg-green-50">
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <CheckCircle className="w-6 h-6 text-green-600" />
                    <div>
                      <p className="font-semibold text-green-800">Application Submitted</p>
                      <p className="text-sm text-green-600">
                        Submitted on {application?.submitted_at && 
                          new Date(application.submitted_at).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                          })
                        }
                      </p>
                    </div>
                  </div>
                  <Badge className="bg-green-600 text-white">
                    {application?.status === 'submitted' ? 'Submitted' : 
                     application?.status === 'under_review' ? 'Under Review' : 'Approved'}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Step 1: Profile & Consortium */}
        {currentStep === 1 && !isSubmitted && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Building2 className="w-5 h-5 text-teal-600" />
                <span>Step 1: Profile & Consortium</span>
              </CardTitle>
              <CardDescription>
                Review your company details
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Primary Applicant Name - Read Only */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Primary Applicant Name (Full Company Name) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={primaryApplicantName}
                  readOnly
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-gray-50 cursor-not-allowed text-gray-700"
                  placeholder="Loading company name..."
                />
              </div>

              {/* Submission Type Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Submission Type <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label
                    className={`flex items-start p-4 border-2 rounded-lg cursor-pointer transition-all ${
                      submissionType === 'single'
                        ? 'border-teal-500 bg-teal-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="submissionType"
                      value="single"
                      checked={submissionType === 'single'}
                      onChange={(e) => {
                        setSubmissionType('single')
                      }}
                      className="mt-1 mr-3 text-teal-600 focus:ring-teal-500"
                    />
                    <div className="flex-1">
                      <div className="font-semibold text-gray-900">Single Company</div>
                      <div className="text-sm text-gray-600 mt-1">
                        Submit as a single company application
                      </div>
                    </div>
                  </label>

                  <label
                    className={`flex items-start p-4 border-2 rounded-lg cursor-pointer transition-all ${
                      submissionType === 'consortium'
                        ? 'border-teal-500 bg-teal-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="submissionType"
                      value="consortium"
                      checked={submissionType === 'consortium'}
                      onChange={(e) => {
                        setSubmissionType('consortium')
                        // The useEffect will handle initialization with user's company
                      }}
                      className="mt-1 mr-3 text-teal-600 focus:ring-teal-500"
                    />
                    <div className="flex-1">
                      <div className="font-semibold text-gray-900">Consortium (JV Partners)</div>
                      <div className="text-sm text-gray-600 mt-1">
                        Submit as a consortium with multiple JV partners
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              {/* Navigation Buttons */}
              <div className="flex justify-end pt-6 border-t">
                <Button onClick={saveStep1} disabled={saving}>
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      Save & Continue
                      <ChevronRight className="w-4 h-4 ml-2" />
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Application Fee */}
        {currentStep === 2 && !isSubmitted && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <CreditCard className="w-5 h-5 text-teal-600" />
                <span>Step 2: Application Fee Payment (Annexure E)</span>
              </CardTitle>
              <CardDescription>
                Pay the application fee of Rs. 100,000 PKR
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Payment Status */}
              {application?.application_fee_status === 'paid' && (
                <div className="space-y-4">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <CheckCircle className="w-6 h-6 text-green-600" />
                      <div>
                        <p className="font-medium text-green-800">Payment Received</p>
                        <p className="text-sm text-green-600">
                          {application.payment_method === 'online' 
                            ? `Transaction ID: ${application.payment_transaction_id || 'N/A'}`
                            : `Bank Challan: ${application.challan_number || 'N/A'}`
                          }
                        </p>
                      </div>
                    </div>
                    {application.payment_method === 'online' && application.payment_transaction_id && (
                      <Button
                        onClick={async () => {
                          if (!application || !areaDetails) return
                          setDownloadingReceipt(true)
                          try {
                            const { data: { user } } = await supabase.auth.getUser()
                            
                            // Fetch user profile for company name and address
                            // Use same approach as BiddingPortalLayout: first check cached userProfile, then fetch from DB
                            let companyName: string | undefined
                            let address: string | undefined
                            
                            // First, try to use cached userProfile from useAuth hook
                            if (userProfile?.company_name) {
                              companyName = userProfile.company_name.trim() || undefined
                            }
                            if (userProfile?.address) {
                              address = userProfile.address.trim() || undefined
                            }
                            
                            // If not available from cache, fetch from database
                            if (user?.id && (!companyName || !address)) {
                              try {
                                const { data: profile, error: profileError } = await supabase
                                  .from('user_profiles')
                                  .select('company_name, address')
                                  .eq('id', user.id)
                                  .single()
                                
                                if (!profileError && profile) {
                                  if (!companyName && profile.company_name) {
                                    companyName = profile.company_name.trim() || undefined
                                  }
                                  if (!address && profile.address) {
                                    address = profile.address.trim() || undefined
                                  }
                                } else if (profileError) {
                                  // If query with 'id' fails, try with 'user_id' as fallback
                                  const { data: profileAlt, error: profileAltError } = await supabase
                                    .from('user_profiles')
                                    .select('company_name, address')
                                    .eq('user_id', user.id)
                                    .maybeSingle()
                                  
                                  if (!profileAltError && profileAlt) {
                                    if (!companyName && profileAlt.company_name) {
                                      companyName = profileAlt.company_name.trim() || undefined
                                    }
                                    if (!address && profileAlt.address) {
                                      address = profileAlt.address.trim() || undefined
                                    }
                                  }
                                }
                              } catch (err) {
                                console.error('Error fetching user profile:', err)
                              }
                            }
                            
                            // Extract basket_id from payment_raw_payload if available
                            let basketId = application.id.substring(0, 8).toUpperCase() // Default fallback
                            if (application.payment_raw_payload) {
                              // payment_raw_payload can be an object or a string (JSON)
                              let payload: any = application.payment_raw_payload
                              if (typeof payload === 'string') {
                                try {
                                  payload = JSON.parse(payload)
                                } catch (e) {
                                  console.error('Error parsing payment_raw_payload:', e)
                                }
                              }
                              if (payload && payload.basket_id) {
                                basketId = payload.basket_id
                              }
                            }
                            
                            const receiptData: PaymentReceiptData = {
                              basketId: basketId,
                              transactionId: application.payment_transaction_id || '',
                              amount: application.application_fee_amount || 100000,
                              currency: 'PKR',
                              paymentDate: application.payment_paid_at || application.updated_at || new Date().toISOString(),
                              paymentMethod: 'PayFast',
                              customerName: user?.user_metadata?.display_name || user?.user_metadata?.full_name || user?.email?.split('@')[0],
                              customerEmail: user?.email,
                              companyName,
                              address,
                              type: 'bid_application',
                              areaName: areaDetails.name || areaDetails.code || 'Bid Application'
                            }
                            await generatePaymentReceipt(receiptData)
                          } catch (error) {
                            console.error('Error generating receipt:', error)
                            setError('Failed to generate receipt. Please try again.')
                          } finally {
                            setDownloadingReceipt(false)
                          }
                        }}
                        disabled={downloadingReceipt}
                        variant="outline"
                        className="flex items-center space-x-2"
                      >
                        {downloadingReceipt ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Generating...</span>
                          </>
                        ) : (
                          <>
                            <Download className="w-4 h-4" />
                            <span>Download Receipt</span>
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {application?.application_fee_status !== 'paid' && (
                <>
                  {/* Fee Amount */}
                  <div className="bg-teal-50 border border-teal-200 rounded-lg p-6 text-center">
                    <p className="text-gray-600 mb-2">Application Fee Amount</p>
                    <p className="text-4xl font-bold text-teal-600">Rs. 100,000</p>
                    <p className="text-gray-500 mt-1">Pakistani Rupees</p>
                  </div>

                  {/* Payment Options */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-3">
                      Select Payment Method
                    </label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Online Payment */}
                      <div
                        onClick={() => setPaymentMethod('online')}
                        className={`p-4 border-2 rounded-lg cursor-pointer transition-all ${
                          paymentMethod === 'online'
                            ? 'border-teal-500 bg-teal-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-center space-x-3">
                          <CreditCard className="w-8 h-8 text-teal-600" />
                          <div>
                            <p className="font-medium text-gray-900">Online Payment</p>
                            <p className="text-sm text-gray-500">Pay via Credit/Debit Card or bank transfer</p>
                          </div>
                        </div>
                      </div>

                      {/* Bank Challan */}
                      <div
                        onClick={() => setPaymentMethod('bank_challan')}
                        className={`p-4 border-2 rounded-lg cursor-pointer transition-all ${
                          paymentMethod === 'bank_challan'
                            ? 'border-teal-500 bg-teal-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-center space-x-3">
                          <Wallet className="w-8 h-8 text-teal-600" />
                          <div>
                            <p className="font-medium text-gray-900">Bank Challan / Draft</p>
                            <p className="text-sm text-gray-500">Upload payment proof</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Bank Challan Form */}
                  {paymentMethod === 'bank_challan' && (
                    <div className="bg-gray-50 rounded-lg p-6 space-y-4">
                      <h4 className="font-medium text-gray-900">Bank Challan Details</h4>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Bank Name <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            value={bankName}
                            onChange={(e) => setBankName(e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                            placeholder="e.g. National Bank of Pakistan"
                          />
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Challan / Draft Number <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            value={challanNumber}
                            onChange={(e) => setChallanNumber(e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                            placeholder="Enter challan number"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Date <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="date"
                          value={challanDate}
                          onChange={(e) => setChallanDate(e.target.value)}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Upload Payment Proof <span className="text-red-500">*</span>
                        </label>
                        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-teal-400 transition-colors">
                          <input
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png"
                            onChange={(e) => setPaymentProofFile(e.target.files?.[0] || null)}
                            className="hidden"
                            id="payment-proof"
                          />
                          <label htmlFor="payment-proof" className="cursor-pointer">
                            <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                            <p className="text-gray-600">
                              {paymentProofFile ? paymentProofFile.name : 'Click to upload or drag and drop'}
                            </p>
                            <p className="text-xs text-gray-400 mt-1">PDF, JPG, PNG (max 10MB)</p>
                          </label>
                        </div>
                        {application?.payment_proof_url && !paymentProofFile && (
                          <div className="mt-2 flex items-center text-sm text-green-600">
                            <CheckCircle className="w-4 h-4 mr-1" />
                            Payment proof already uploaded
                          </div>
                        )}
                      </div>

                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                        <label className="flex items-start gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={paymentProofAgreementChecked}
                            onChange={(e) => setPaymentProofAgreementChecked(e.target.checked)}
                            className="mt-1 h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                          />
                          <span className="text-sm text-amber-900 leading-relaxed">
                            I agree that this payment proof is genuine and that payment has been made through draft/Bank Challan.
                            In case of wrong submission, my application may be cancelled at any stage.
                          </span>
                        </label>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Navigation Buttons */}
              <div className="flex justify-between pt-6 border-t">
                <Button variant="outline" onClick={() => setCurrentStep(1)}>
                  <ChevronLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
                
                {application?.application_fee_status === 'paid' ? (
                  <Button onClick={() => setCurrentStep(3)}>
                    Continue to Work Unit
                    <ChevronRight className="w-4 h-4 ml-2" />
                  </Button>
                ) : paymentMethod === 'online' ? (
                  <Button onClick={initiateOnlinePayment} disabled={saving} className="text-white">
                    {saving ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Redirecting...
                      </>
                    ) : (
                      <>
                        <CreditCard className="w-4 h-4 mr-2" />
                        Pay Rs. 100,000 Online
                      </>
                    )}
                  </Button>
                ) : paymentMethod === 'bank_challan' ? (
                  <Button onClick={saveStep2Challan} disabled={saving || uploadingProof || !paymentProofAgreementChecked}>
                    {saving ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        {uploadingProof ? 'Uploading...' : 'Saving...'}
                      </>
                    ) : (
                      <>
                        Save & Continue
                        <ChevronRight className="w-4 h-4 ml-2" />
                      </>
                    )}
                  </Button>
                ) : (
                  <Button disabled>Select Payment Method</Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Work Unit */}
        {currentStep === 3 && !isSubmitted && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <FileText className="w-5 h-5 text-teal-600" />
                <span>Step 3: Work Unit</span>
              </CardTitle>
              <CardDescription>
                Enter your work units offered. The total work units are calculated automatically.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {error && (
                <div className="bg-red-100 text-red-700 px-4 py-3 rounded-lg">
                  {error}
                </div>
              )}

              {successMessage && (
                <div className="bg-green-100 text-green-700 px-4 py-3 rounded-lg">
                  {successMessage}
                </div>
              )}

              {/* Work Unit - At the top */}
              <div>
                {/* Formula + live total */}
                <div className="mb-4 rounded-lg border border-teal-100 bg-teal-50 p-4">
                  <p className="text-xs font-medium text-teal-800">
                    Total Work Units = 100 + (Work Units Offered × Grid Area)
                  </p>
                  <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-gray-700">
                    <span>Grid Area:</span>
                    <span className="font-semibold text-gray-900">{gridArea}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-gray-700">
                    <span className="font-mono">
                      100 + ({workUnit && !isNaN(offeredNum) ? offeredNum : 0} × {gridArea}) =
                    </span>
                    <span className="text-lg font-bold text-teal-700">
                      {workUnit && !isNaN(offeredNum) ? totalWorkUnits : 0}
                    </span>
                    <span className="text-xs text-gray-500">total work units</span>
                  </div>
                  <p className="mt-2 text-xs text-gray-500">
                    This total is the value saved to your application.
                  </p>
                </div>

                <div className="flex items-center justify-between mb-2">
                  <label htmlFor="workUnit" className="block text-sm font-medium text-gray-700">
                    Work Units Offered <span className="text-red-500">*</span>
                  </label>
                  {application?.work_units_encrypted_at && (
                    <span className="text-xs text-green-600 flex items-center gap-1">
                      <CheckCircle className="w-4 h-4" />
                      Encrypted & Saved
                    </span>
                  )}
                </div>
                <input
                  id="workUnit"
                  type="number"
                  min="101"
                  step="1"
                  value={workUnit}
                  onChange={(e) => {
                    const value = e.target.value
                    // Only allow numbers
                    if (value === '' || (!isNaN(Number(value)) && Number(value) >= 0)) {
                      setWorkUnit(value)
                      // Validate: must be 100 or above
                      if (value !== '' && (!isNaN(Number(value)) && Number(value) < 100)) {
                        setWorkUnitError('Work units offered must be 100 or above')
                      } else {
                        setWorkUnitError('')
                      }
                      // Clear percentage error when work unit changes
                      setPercentageError('')
                    }
                  }}
                  className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent ${
                    workUnitError ? 'border-red-500' : 'border-gray-300'
                  }`}
                  required
                  disabled={saving}
                />
                {workUnitError && (
                  <p className="text-xs text-red-600 mt-1">
                    {workUnitError}
                  </p>
                )}
              </div>

              {/* Consortium Companies - Only show if submission type is consortium */}
              {application?.submission_type === 'consortium' && (
                <div className="mt-6">
                  <label className="block text-sm font-medium text-gray-700 mb-3">
                    Designated Operators (Consortium Companies) <span className="text-red-500">*</span>
                  </label>
                  <p className="text-xs text-gray-500 mb-3">
                    Select company names from the list or enter custom names. Enter work unit percentage for each JV partner. Total percentage must equal 100%.
                  </p>
                  
                  {/* Header row */}
                  <div className="grid grid-cols-12 gap-3 mb-2 px-2">
                    <div className="col-span-8">
                      <span className="text-xs font-medium text-gray-600">Company Name</span>
                    </div>
                    <div className="col-span-3">
                      <span className="text-xs font-medium text-gray-600">Percentage</span>
                    </div>
                    <div className="col-span-1"></div>
                  </div>

                  <div className="space-y-3">
                    {consortiumCompanies.map((company, index) => {
                      const companyKey = `company_${index}`
                      const percentage = consortiumPercentages[companyKey] || ''
                      const calculatedUnits = totalWorkUnits && percentage ? ((totalWorkUnits * Number(percentage)) / 100).toFixed(2) : '0.00'
                      
                      return (
                        <div key={index} className="grid grid-cols-12 gap-3 items-start">
                          {/* Company Name - 70% (8 columns) */}
                          <div className="col-span-8">
                            <div className="flex items-center space-x-2 relative">
                              <span className="text-gray-500 font-medium text-sm w-6">{index + 1}.</span>
                              <div className="flex-1 relative">
                                <input
                                  ref={(el) => { companyInputRefs.current[index] = el }}
                                  type="text"
                                  value={index === 0 ? (userCompanyName || userProfile?.company_name || company) : company}
                                  onChange={(e) => {
                                    // Prevent editing the first field (user's company)
                                    if (index === 0) return
                                    handleCompanyNameChange(index, e.target.value)
                                  }}
                                  onFocus={() => {
                                    // Prevent focusing the first field (user's company)
                                    if (index === 0) return
                                    handleCompanyNameFocus(index)
                                  }}
                                  className={`w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent ${
                                    index === 0 ? 'bg-gray-100 cursor-not-allowed' : ''
                                  }`}
                                  placeholder={index === 0 ? "Your company (auto-filled)" : "Select or enter company name"}
                                  disabled={saving || index === 0}
                                  readOnly={index === 0}
                                  autoComplete="off"
                                />
                                {index !== 0 && companyDropdowns[index] && (filteredCompanies[index] || companyNames).length > 0 && (
                                  <div
                                    ref={(el) => { companyDropdownRefs.current[index] = el }}
                                    className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto"
                                  >
                                    {(filteredCompanies[index] || companyNames).map((companyName, idx) => (
                                      <button
                                        key={idx}
                                        type="button"
                                        onClick={() => handleCompanySelect(index, companyName)}
                                        className="w-full text-left px-4 py-2 hover:bg-teal-500 hover:text-white transition-colors cursor-pointer first:rounded-t-lg last:rounded-b-lg"
                                      >
                                        {companyName}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                          
                          {/* Percentage - 30% (3 columns) */}
                          <div className="col-span-3">
                            <div className="flex items-center space-x-1">
                              <input
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                value={percentage}
                                onChange={(e) => {
                                  const value = e.target.value
                                  if (value === '' || (!isNaN(Number(value)) && Number(value) >= 0 && Number(value) <= 100)) {
                                    setConsortiumPercentages({
                                      ...consortiumPercentages,
                                      [companyKey]: value
                                    })
                                    setPercentageError('')
                                  }
                                }}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                                placeholder="0.00"
                                disabled={saving || company.trim() === ''}
                              />
                              <span className="text-gray-500 text-sm">%</span>
                            </div>
                          </div>
                          
                          {/* Delete button - 1 column */}
                          <div className="col-span-1 flex items-start pt-2">
                            {consortiumCompanies.length > 1 && index !== 0 && (
                              <button
                                onClick={() => {
                                  const updated = consortiumCompanies.filter((_, i) => i !== index)
                                  setConsortiumCompanies(updated)
                                  // Clear percentage for removed company
                                  const newPercentages = { ...consortiumPercentages }
                                  delete newPercentages[companyKey]
                                  setConsortiumPercentages(newPercentages)
                                }}
                                className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                                disabled={saving}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  
                  {percentageError && (
                    <p className="text-xs text-red-600 mt-2">
                      {percentageError}
                    </p>
                  )}
                  
                  <button
                    onClick={() => setConsortiumCompanies([...consortiumCompanies, ''])}
                    className="mt-3 flex items-center space-x-2 text-teal-600 hover:text-teal-700 font-medium"
                    disabled={saving}
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add Another Partner</span>
                  </button>
                </div>
              )}

               {/* Navigation Buttons */}
               <div className="flex justify-between pt-6 border-t">
                 <Button variant="outline" onClick={() => setCurrentStep(2)} disabled={saving}>
                   <ChevronLeft className="w-4 h-4 mr-2" />
                   Back
                 </Button>
                 
                <Button 
                  onClick={async () => {
                    if (!workUnit || workUnit.trim() === '') {
                      setWorkUnitError('Work units offered is required')
                      setError('Work units offered is required')
                      return
                    }
                    
                    const workUnitNum = Number(workUnit)
                    if (isNaN(workUnitNum) || workUnitNum < 101) {
                      setWorkUnitError('Work units offered must be 101 or above')
                      setError('Work units offered must be 101 or above')
                      return
                    }

                    // Total = 100 + (offered x grid_area). This computed total is what gets saved.
                    const totalToSave = 100 + workUnitNum * gridArea

                    // Validate consortium companies and percentages if consortium submission
                    if (application?.submission_type === 'consortium') {
                      const validCompanies = consortiumCompanies.filter(c => c.trim() !== '')
                      if (validCompanies.length === 0) {
                        setError('At least one consortium company is required')
                        return
                      }
                      // Check for duplicate company names
                      const uniqueCompanies = new Set(validCompanies.map(c => c.trim().toLowerCase()))
                      if (uniqueCompanies.size !== validCompanies.length) {
                        setError('Duplicate company names are not allowed')
                        return
                      }
                      // Validate percentages - check each valid company has a percentage
                      const missingPercentages: number[] = []
                      validCompanies.forEach((_, validIndex) => {
                        // Find the original index in consortiumCompanies array
                        let originalIndex = 0
                        let foundCount = 0
                        for (let i = 0; i < consortiumCompanies.length; i++) {
                          if (consortiumCompanies[i].trim() !== '') {
                            if (foundCount === validIndex) {
                              originalIndex = i
                              break
                            }
                            foundCount++
                          }
                        }
                        const companyKey = `company_${originalIndex}`
                        if (!consortiumPercentages[companyKey] || consortiumPercentages[companyKey] === '') {
                          missingPercentages.push(validIndex + 1)
                        }
                      })
                      
                      if (missingPercentages.length > 0) {
                        setPercentageError(`Please enter percentage for all JV partners`)
                        setError(`Please enter percentage for all JV partners`)
                        return
                      }
                      
                      // Validate total percentage equals 100%
                      const totalPercentage = Object.values(consortiumPercentages).reduce((sum, p) => sum + (Number(p) || 0), 0)
                      if (Math.abs(totalPercentage - 100) > 0.01) {
                        setPercentageError(`Total percentage must equal 100%. Current total: ${totalPercentage.toFixed(2)}%`)
                        setError(`Total percentage must equal 100%. Current total: ${totalPercentage.toFixed(2)}%`)
                        return
                      }
                    }
                    
                    if (!application) return
                    
                    try {
                      setSaving(true)
                      setError('')
                      setWorkUnitError('')
                      setPercentageError('')
                      const token = await getAuthToken()

                      // Prepare consortium companies data
                      const validCompanies = application.submission_type === 'consortium' 
                        ? consortiumCompanies.filter(c => c.trim() !== '')
                        : []

                       const response = await fetch(`/api/bid-applications/${application.id}`, {
                         method: 'PATCH',
                         headers: {
                           'Content-Type': 'application/json',
                           'Authorization': `Bearer ${token}`
                         },
                         body: JSON.stringify({
                           work_units: totalToSave,
                           consortium_companies: application.submission_type === 'consortium' ? validCompanies : undefined,
                           consortium_percentages: application.submission_type === 'consortium' ? consortiumPercentages : undefined
                         })
                       })

                       if (!response.ok) {
                         const err = await response.json()
                         throw new Error(err.error || 'Failed to save')
                       }

                       const updated = await response.json()
                       setApplication(updated)
                       setSuccessMessage('Work unit saved!')
                       setTimeout(() => setSuccessMessage(''), 3000)
                       setCurrentStep(4) // Go to Documents step
                     } catch (err: any) {
                       setError(err.message)
                     } finally {
                       setSaving(false)
                     }
                   }}
                   disabled={saving}
                 >
                   {saving ? (
                     <>
                       <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                       Saving...
                     </>
                   ) : (
                     <>
                       Continue to Documents
                       <ChevronRight className="w-4 h-4 ml-2" />
                     </>
                   )}
                 </Button>
               </div>
             </CardContent>
           </Card>
         )}

        {/* Step 4: Documents */}
        {currentStep === 4 && !isSubmitted && (
         <Card className="border-0 shadow-lg">
           <CardHeader className="bg-gradient-to-r from-teal-600 to-teal-700 text-white rounded-t-lg">
             <div className="flex items-center justify-between">
               <div>
                 <CardTitle className="flex items-center space-x-2 text-white">
                   <FileText className="w-5 h-5" />
                   <span>Step 4: Document Upload</span>
                 </CardTitle>
                 <CardDescription className="text-teal-100 mt-1">
                   Upload all required documents. Fields marked with <span className="text-red-300">*</span> are mandatory.
                 </CardDescription>
               </div>
               <div className="text-right bg-white/10 rounded-lg px-4 py-2">
                 <div className="text-2xl font-bold">{docProgress.percentage}%</div>
                 <div className="text-sm text-teal-100">
                   {docProgress.uploaded}/{docProgress.required} completed
                 </div>
               </div>
             </div>
             {/* Progress bar */}
             <div className="mt-4 h-3 bg-white/20 rounded-full overflow-hidden">
               <div 
                 className={`h-full transition-all duration-500 ${
                   docProgress.percentage === 100 ? 'bg-green-400' : 'bg-white'
                 }`}
                 style={{ width: `${docProgress.percentage}%` }}
               />
             </div>
           </CardHeader>
           <CardContent className="p-6">
             {/* Quick Stats */}
             <div className="grid grid-cols-3 gap-4 mb-6 p-4 bg-gray-50 rounded-lg">
               <div className="text-center">
                 <div className="text-2xl font-bold text-red-600">
                   {docProgress.required - docProgress.uploaded}
                 </div>
                 <div className="text-xs text-gray-500">Pending</div>
               </div>
               <div className="text-center border-x border-gray-200">
                 <div className="text-2xl font-bold text-green-600">
                   {docProgress.uploaded}
                 </div>
                 <div className="text-xs text-gray-500">Uploaded</div>
               </div>
               <div className="text-center">
                 <div className="text-2xl font-bold text-gray-700">
                   {docProgress.required}
                 </div>
                 <div className="text-xs text-gray-500">Total Required</div>
               </div>
             </div>

             {/* Document List */}
             {(() => {
               const sections: Record<string, Array<[string, typeof DOCUMENT_TYPES[keyof typeof DOCUMENT_TYPES]]>> = {}
               
               Object.entries(DOCUMENT_TYPES).forEach(([key, docType]) => {
                 const section = docType.section || 'other'
                 if (!sections[section]) {
                   sections[section] = []
                 }
                 sections[section].push([key, docType])
               })
               
               const sectionLabels: Record<string, { label: string; icon: string }> = {
                 annexures: { label: 'Annexures', icon: '📋' },
                 company: { label: 'Company Documents', icon: '🏢' },
                 financials: { label: 'Financial Documents', icon: '💰' },
                 other: { label: 'Other Documents', icon: '📁' }
               }
               
               return (
                 <div className="space-y-6">
                   {Object.entries(sections).map(([sectionKey, sectionDocs]) => (
                     <div key={sectionKey} className="border border-gray-200 rounded-lg overflow-hidden">
                       {/* Section Header */}
                       <div className="bg-gray-100 px-4 py-3 border-b border-gray-200">
                         <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                           <span>{sectionLabels[sectionKey]?.icon || '📄'}</span>
                           {sectionLabels[sectionKey]?.label || sectionKey}
                         </h3>
                       </div>
                       
                       {/* Document List Items */}
                       <div className="divide-y divide-gray-100">
                         {sectionDocs.map(([key, docType], idx) => {
                           const docTypeKey = key as DocumentTypeKey
                           const isMultipleFiles = docType.multipleFiles
                           
                           // For per-company documents (consortium)
                           if (docType.perCompany && submissionType === 'consortium') {
                             // For financial reports - each company needs 5 files
                             if (isMultipleFiles) {
                               return (
                                 <div key={key} className="bg-white">
                                   <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                                     <div className="flex items-center gap-2">
                                       <span className="text-red-500 font-bold">*</span>
                                       <span className="font-medium text-gray-900">{docType.label}</span>
                                       <span className="text-xs text-gray-500 ml-2">
                                         (Required for each company - {docType.maxFiles || 5} files each)
                                       </span>
                                     </div>
                                   </div>
                                   
                                   <div className="divide-y divide-gray-50">
                                     {application?.consortium_companies?.map((company) => {
                                       const docs = getUploadedDocument(docTypeKey, company.id)
                                       const docsArray = Array.isArray(docs) ? docs : []
                                       const isComplete = docsArray.length >= (docType.maxFiles || 5)
                                       const isPartial = docsArray.length > 0 && docsArray.length < (docType.maxFiles || 5)
                                       const isUploading = uploadingDoc?.includes(`${docTypeKey}_${company.id}`)
                                       
                                       return (
                                         <div 
                                           key={company.id} 
                                           className={`px-4 py-4 ${
                                             isComplete 
                                               ? 'bg-green-50' 
                                               : isPartial
                                                 ? 'bg-amber-50'
                                                 : 'bg-red-50'
                                           }`}
                                         >
                                           <div className="flex items-center justify-between mb-3">
                                             <div className="flex items-center gap-3">
                                               {isComplete ? (
                                                 <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center">
                                                   <CheckCircle className="w-5 h-5 text-white" />
                                                 </div>
                                               ) : (
                                                 <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold ${
                                                   isPartial ? 'bg-amber-500' : 'bg-red-500'
                                                 }`}>
                                                   {docsArray.length}
                                                 </div>
                                               )}
                                               <div>
                                                 <p className="font-medium text-gray-900">{company.company_name}</p>
                                                 <p className={`text-xs ${
                                                   isComplete ? 'text-green-600' : isPartial ? 'text-amber-600' : 'text-red-600'
                                                 }`}>
                                                   {isComplete 
                                                     ? `✓ All ${docType.maxFiles || 5} files uploaded`
                                                     : `${docsArray.length}/${docType.maxFiles || 5} files uploaded`
                                                   }
                                                 </p>
                                               </div>
                                             </div>
                                             
                                             {!isComplete && (
                                               <label className="cursor-pointer">
                                                 <input
                                                   type="file"
                                                   accept=".pdf,application/pdf"
                                                   multiple
                                                   className="hidden"
                                                   onChange={async (e) => {
                                                     const files = Array.from(e.target.files || [])
                                                     if (files.length > 0) {
                                                       const remainingSlots = (docType.maxFiles || 5) - docsArray.length
                                                       const filesToUpload = files.slice(0, remainingSlots)
                                                       
                                                       if (files.length > remainingSlots) {
                                                         setError(`You can only upload ${remainingSlots} more file(s) for ${company.company_name}`)
                                                       }
                                                       
                                                       const inputElement = e.target as HTMLInputElement
                                                       setUploadingDoc(`${docTypeKey}_${company.id}_batch`)
                                                       
                                                       try {
                                                         for (const file of filesToUpload) {
                                                           await uploadDocument(docTypeKey, file, company.id)
                                                           await new Promise(resolve => setTimeout(resolve, 300))
                                                         }
                                                       } finally {
                                                         setUploadingDoc(null)
                                                         inputElement.value = ''
                                                       }
                                                     }
                                                   }}
                                                   disabled={isUploading}
                                                 />
                                                 <span className={`inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                                                   isUploading
                                                     ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                                     : 'bg-teal-600 text-white hover:bg-teal-700'
                                                 }`}>
                                                   {isUploading ? (
                                                     <>
                                                       <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                                       Uploading...
                                                     </>
                                                   ) : (
                                                     <>
                                                       <Upload className="w-4 h-4 mr-2" />
                                                       Add Files
                                                     </>
                                                   )}
                                                 </span>
                                               </label>
                                             )}
                                           </div>
                                           
                                           {/* Uploaded files for this company */}
                                           {docsArray.length > 0 && (
                                             <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-3">
                                               {docsArray.map((uploadedDoc, index) => (
                                                 <div 
                                                   key={uploadedDoc.id}
                                                   className="flex items-center justify-between p-2 bg-white border border-green-200 rounded-lg text-sm"
                                                 >
                                                   <div className="flex items-center gap-2 flex-1 min-w-0">
                                                     <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                                                     <span className="truncate text-gray-700" title={uploadedDoc.file_name}>
                                                       Year {index + 1}
                                                     </span>
                                                   </div>
                                                   <button
                                                     onClick={() => deleteDocument(uploadedDoc.id)}
                                                     className="p-1 text-red-500 hover:bg-red-50 rounded flex-shrink-0"
                                                     title="Delete"
                                                   >
                                                     <Trash2 className="w-3 h-3" />
                                                   </button>
                                                 </div>
                                               ))}
                                             </div>
                                           )}
                                         </div>
                                       )
                                     })}
                                   </div>
                                 </div>
                               )
                             }
                             
                             // For other per-company documents (single file each)
                             return (
                               <div key={key} className="bg-white">
                                 <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                                   <div className="flex items-center gap-2">
                                     <span className="text-red-500 font-bold">*</span>
                                     <span className="font-medium text-gray-900">{docType.label}</span>
                                     <span className="text-xs text-gray-500 ml-2">(Required for each company)</span>
                                   </div>
                                 </div>
                                 
                                 <div className="divide-y divide-gray-50">
                                   {application?.consortium_companies?.map((company) => {
                                     const doc = getUploadedDocument(docTypeKey, company.id)
                                     const hasDoc = doc && !Array.isArray(doc)
                                     const isUploading = uploadingDoc === `${docTypeKey}_${company.id}`
                                     
                                     return (
                                       <div 
                                         key={company.id} 
                                         className={`px-4 py-3 flex items-center justify-between ${
                                           hasDoc ? 'bg-green-50' : 'bg-red-50'
                                         }`}
                                       >
                                         <div className="flex items-center gap-3 flex-1 min-w-0">
                                           {hasDoc ? (
                                             <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
                                           ) : (
                                             <div className="w-5 h-5 rounded-full bg-red-200 flex-shrink-0" />
                                           )}
                                           <div className="flex-1 min-w-0">
                                             <p className="font-medium text-gray-900">{company.company_name}</p>
                                             {hasDoc && (
                                               <p className="text-xs text-gray-500 truncate">{doc.file_name}</p>
                                             )}
                                           </div>
                                         </div>
                                         
                                         <div className="flex items-center gap-2 flex-shrink-0">
                                           {hasDoc && (
                                             <button
                                               onClick={() => deleteDocument(doc.id)}
                                               className="p-2 text-red-500 hover:bg-red-100 rounded-lg"
                                             >
                                               <Trash2 className="w-4 h-4" />
                                             </button>
                                           )}
                                           <label className="cursor-pointer">
                                             <input
                                               type="file"
                                               accept=".pdf,application/pdf"
                                               className="hidden"
                                               onChange={(e) => {
                                                 const file = e.target.files?.[0]
                                                 if (file) uploadDocument(docTypeKey, file, company.id)
                                               }}
                                               disabled={isUploading}
                                             />
                                             <span className={`inline-flex items-center px-3 py-1.5 text-sm rounded-lg transition-colors ${
                                               isUploading 
                                                 ? 'bg-gray-200 text-gray-400' 
                                                 : hasDoc
                                                   ? 'bg-teal-100 text-teal-700 hover:bg-teal-200'
                                                   : 'bg-teal-600 text-white hover:bg-teal-700'
                                             }`}>
                                               {isUploading ? (
                                                 <>
                                                   <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                                                   Uploading...
                                                 </>
                                               ) : (
                                                 <>
                                                   <Upload className="w-4 h-4 mr-1" />
                                                   {hasDoc ? 'Replace' : 'Upload'}
                                                 </>
                                               )}
                                             </span>
                                           </label>
                                         </div>
                                       </div>
                                     )
                                   })}
                                 </div>
                               </div>
                             )
                           }

                           // Regular documents (single company or single file types)
                           const doc = getUploadedDocument(docTypeKey)
                           const isUploading = uploadingDoc === docTypeKey || uploadingDoc?.includes(docTypeKey)
                           
                           // Handle multiple files (for single company financial reports)
                           if (isMultipleFiles) {
                             const docsArray = Array.isArray(doc) ? doc : []
                             const isComplete = docsArray.length >= (docType.maxFiles || 5)
                             const isPartial = docsArray.length > 0 && docsArray.length < (docType.maxFiles || 5)
                             
                             return (
                               <div 
                                 key={key}
                                 className={`px-4 py-4 ${
                                   isComplete 
                                     ? 'bg-green-50' 
                                     : isPartial
                                       ? 'bg-amber-50'
                                       : 'bg-red-50'
                                 }`}
                               >
                                 <div className="flex items-center justify-between mb-3">
                                   <div className="flex items-center gap-3">
                                     {isComplete ? (
                                       <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center">
                                         <CheckCircle className="w-6 h-6 text-white" />
                                       </div>
                                     ) : (
                                       <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold ${
                                         isPartial ? 'bg-amber-500' : 'bg-red-500'
                                       }`}>
                                         {docsArray.length}/{docType.maxFiles || 5}
                                       </div>
                                     )}
                                     <div>
                                       <div className="flex items-center gap-2">
                                         <span className="text-red-500 font-bold">*</span>
                                         <span className="font-medium text-gray-900">{docType.label}</span>
                                       </div>
                                       <p className={`text-sm ${
                                         isComplete ? 'text-green-600' : isPartial ? 'text-amber-600' : 'text-red-600'
                                       }`}>
                                         {isComplete 
                                           ? `✓ All ${docType.maxFiles || 5} files uploaded`
                                           : `${docsArray.length}/${docType.maxFiles || 5} files required`
                                         }
                                       </p>
                                     </div>
                                   </div>
                                   
                                   {!isComplete && (
                                     <label className="cursor-pointer">
                                       <input
                                         type="file"
                                         accept=".pdf,application/pdf"
                                         multiple
                                         className="hidden"
                                         onChange={async (e) => {
                                           const files = Array.from(e.target.files || [])
                                           if (files.length > 0) {
                                             const remainingSlots = (docType.maxFiles || 5) - docsArray.length
                                             const filesToUpload = files.slice(0, remainingSlots)
                                             
                                             if (files.length > remainingSlots) {
                                               setError(`You can only upload ${remainingSlots} more file(s)`)
                                             }
                                             
                                             const inputElement = e.target as HTMLInputElement
                                             setUploadingDoc(`${docTypeKey}_batch`)
                                             
                                             try {
                                               for (const file of filesToUpload) {
                                                 await uploadDocument(docTypeKey, file)
                                                 await new Promise(resolve => setTimeout(resolve, 300))
                                               }
                                             } finally {
                                               setUploadingDoc(null)
                                               inputElement.value = ''
                                             }
                                           }
                                         }}
                                         disabled={isUploading}
                                       />
                                       <span className={`inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                                         isUploading
                                           ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                           : 'bg-teal-600 text-white hover:bg-teal-700'
                                       }`}>
                                         {isUploading ? (
                                           <>
                                             <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                             Uploading...
                                           </>
                                         ) : (
                                           <>
                                             <Upload className="w-4 h-4 mr-2" />
                                             Add Files ({(docType.maxFiles || 5) - docsArray.length} remaining)
                                           </>
                                         )}
                                       </span>
                                     </label>
                                   )}
                                 </div>
                                 
                                 {/* Uploaded files grid */}
                                 {docsArray.length > 0 && (
                                   <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 mt-3">
                                     {Array.from({ length: docType.maxFiles || 5 }).map((_, index) => {
                                       const uploadedDoc = docsArray[index]
                                       return (
                                         <div 
                                           key={index}
                                           className={`flex items-center justify-between p-3 rounded-lg text-sm ${
                                             uploadedDoc 
                                               ? 'bg-white border-2 border-green-300'
                                               : 'bg-gray-100 border-2 border-dashed border-gray-300'
                                           }`}
                                         >
                                           {uploadedDoc ? (
                                             <>
                                               <div className="flex items-center gap-2 flex-1 min-w-0">
                                                 <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                                                 <span className="font-medium text-gray-700">Year {index + 1}</span>
                                               </div>
                                               <button
                                                 onClick={() => deleteDocument(uploadedDoc.id)}
                                                 className="p-1 text-red-500 hover:bg-red-50 rounded flex-shrink-0"
                                                 title="Delete"
                                               >
                                                 <Trash2 className="w-3 h-3" />
                                               </button>
                                             </>
                                           ) : (
                                             <div className="flex items-center gap-2 text-gray-400 w-full justify-center">
                                               <Upload className="w-4 h-4" />
                                               <span>Year {index + 1}</span>
                                             </div>
                                           )}
                                         </div>
                                       )
                                     })}
                                   </div>
                                 )}
                               </div>
                             )
                           }
                           
                           // Single file document
                           const hasDoc = doc && !Array.isArray(doc)
                           
                           return (
                             <div 
                               key={key}
                               className={`px-4 py-3 flex items-center justify-between transition-colors ${
                                 hasDoc ? 'bg-green-50' : 'bg-red-50'
                               }`}
                             >
                               <div className="flex items-center gap-3 flex-1 min-w-0">
                                 {hasDoc ? (
                                   <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                                     <CheckCircle className="w-5 h-5 text-white" />
                                   </div>
                                 ) : (
                                   <div className="w-8 h-8 rounded-full bg-red-200 flex items-center justify-center flex-shrink-0">
                                     <span className="text-red-600 text-xs font-bold">!</span>
                                   </div>
                                 )}
                                 <div className="flex-1 min-w-0">
                                   <div className="flex items-center gap-1">
                                     <span className="text-red-500 font-bold">*</span>
                                     <span className={`font-medium ${hasDoc ? 'text-green-800' : 'text-gray-900'}`}>
                                       {docType.label}
                                     </span>
                                   </div>
                                   {hasDoc && (
                                     <p className="text-xs text-green-600 truncate mt-0.5">
                                       ✓ {doc.file_name}
                                     </p>
                                   )}
                                   {!hasDoc && (
                                     <p className="text-xs text-red-600 mt-0.5">
                                       Document not uploaded
                                     </p>
                                   )}
                                 </div>
                               </div>
                               
                               <div className="flex items-center gap-2 flex-shrink-0">
                                 {hasDoc && (
                                   <button
                                     onClick={() => deleteDocument(doc.id)}
                                     className="p-2 text-red-500 hover:bg-red-100 rounded-lg transition-colors"
                                     title="Delete"
                                   >
                                     <Trash2 className="w-4 h-4" />
                                   </button>
                                 )}
                                 <label className="cursor-pointer">
                                   <input
                                     type="file"
                                     accept=".pdf,application/pdf"
                                     className="hidden"
                                     onChange={(e) => {
                                       const file = e.target.files?.[0]
                                       if (file) uploadDocument(docTypeKey, file)
                                     }}
                                     disabled={isUploading}
                                   />
                                   <span className={`inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                                     isUploading
                                       ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                       : hasDoc
                                         ? 'bg-teal-100 text-teal-700 hover:bg-teal-200'
                                         : 'bg-teal-600 text-white hover:bg-teal-700'
                                   }`}>
                                     {isUploading ? (
                                       <>
                                         <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                         Uploading...
                                       </>
                                     ) : (
                                       <>
                                         <Upload className="w-4 h-4 mr-2" />
                                         {hasDoc ? 'Replace' : 'Upload'}
                                       </>
                                     )}
                                   </span>
                                 </label>
                               </div>
                             </div>
                           )
                         })}
                       </div>
                     </div>
                   ))}
                 </div>
               )
             })()}

             {/* Info box */}
             <div className="mt-6 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-4">
               <div className="flex items-start gap-3">
                 <Info className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                 <div className="text-sm">
                   <p className="font-semibold text-blue-800 mb-2">Document Requirements</p>
                   <ul className="space-y-1 text-blue-700">
                     <li className="flex items-center gap-2">
                       <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                       Accepted format: PDF only
                     </li>
                     <li className="flex items-center gap-2">
                       <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                       Maximum file size: 50MB per document
                     </li>
                     <li className="flex items-center gap-2">
                       <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                       All fields marked with <span className="text-red-500 font-bold">*</span> are required
                     </li>
                     <li className="flex items-center gap-2">
                       <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                       Financial reports: Upload 5 years of reports for each company
                     </li>
                   </ul>
                 </div>
               </div>
             </div>

             {/* Navigation Buttons */}
             <div className="flex justify-between pt-6 mt-6 border-t border-gray-200">
               <Button 
                 variant="outline" 
                 onClick={() => {
                   // If work units are already encrypted, skip work unit step and go to payment step
                   if (application?.work_units_encrypted_at) {
                     setCurrentStep(2) // Go to payment step (can't edit work units after encryption)
                   } else {
                     setCurrentStep(3) // Go to work unit step
                   }
                 }} 
                 className="gap-2"
               >
                 <ChevronLeft className="w-4 h-4" />
                 {application?.work_units_encrypted_at ? 'Back to Payment' : 'Back to Work Unit'}
               </Button>
               
               <Button 
                 onClick={() => setCurrentStep(5)}
                 className="gap-2 bg-teal-600 hover:bg-teal-700"
                 disabled={docProgress.percentage < 100}
               >
                 {docProgress.percentage < 100 ? (
                   <>
                     Complete All Documents First
                     <span className="ml-2 text-xs bg-white/20 px-2 py-0.5 rounded">
                       {docProgress.required - docProgress.uploaded} remaining
                     </span>
                   </>
                 ) : (
                   <>
                     Continue to Review
                     <ChevronRight className="w-4 h-4" />
                   </>
                 )}
               </Button>
             </div>
           </CardContent>
         </Card>
       )}


         {/* Step 5: Review & Submit */}
         {(currentStep === 5 || isSubmitted) && (
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Profile Summary */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center space-x-2">
                    <Building2 className="w-4 h-4 text-teal-600" />
                    <span>Profile</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    <div>
                      <p className="text-gray-500">Applicant</p>
                      <p className="font-medium">{application?.primary_applicant_name}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Type</p>
                      <p className="font-medium capitalize">{application?.submission_type}</p>
                    </div>
                    {application?.submission_type === 'consortium' && (
                      <div>
                        <p className="text-gray-500">Consortium Companies</p>
                        <ul className="font-medium">
                          {application.consortium_companies?.map((c, i) => (
                            <li key={c.id}>{i + 1}. {c.company_name}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Payment Summary */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center space-x-2">
                    <CreditCard className="w-4 h-4 text-teal-600" />
                    <span>Payment</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    <div>
                      <p className="text-gray-500">Amount</p>
                      <p className="font-medium">Rs. 100,000 PKR</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Status</p>
                      <Badge className={
                        application?.application_fee_status === 'paid' 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-yellow-100 text-yellow-800'
                      }>
                        {application?.application_fee_status === 'paid' ? 'Paid' : 'Pending'}
                      </Badge>
                    </div>
                    <div>
                      <p className="text-gray-500">Method</p>
                      <p className="font-medium capitalize">
                        {application?.payment_method === 'bank_challan' ? 'Bank Challan' : 'Online'}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Documents Summary */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center space-x-2">
                    <FileText className="w-4 h-4 text-teal-600" />
                    <span>Documents</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    <div>
                      <p className="text-gray-500">Uploaded</p>
                      <p className="font-medium">{docProgress.uploaded} of {docProgress.required}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Progress</p>
                      <div className="flex items-center space-x-2">
                        <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div 
                            className={`h-full ${docProgress.percentage === 100 ? 'bg-green-500' : 'bg-teal-600'}`}
                            style={{ width: `${docProgress.percentage}%` }}
                          />
                        </div>
                        <span className="font-medium">{docProgress.percentage}%</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

             {/* Work Unit */}
             {(application?.work_units || application?.work_units_encrypted_at) && (
               <Card>
                 <CardHeader>
                   <CardTitle className="flex items-center space-x-2">
                     <FileText className="w-5 h-5 text-teal-600" />
                     <span>Work Unit</span>
                   </CardTitle>
                 </CardHeader>
                 <CardContent>
                   <div className="bg-gray-50 rounded-lg p-4 mb-4">
                     {application.work_units ? (
                       <p className="text-gray-700 text-lg font-semibold">{application.work_units} units</p>
                     ) : application.work_units_encrypted_at ? (
                       <div className="flex items-center gap-2">
                         <Lock className="w-5 h-5 text-green-600" />
                         <p className="text-gray-700 text-lg font-semibold">Encrypted & Secured</p>
                         <span className="text-xs text-gray-500">
                           (Saved on {new Date(application.work_units_encrypted_at).toLocaleDateString()})
                         </span>
                       </div>
                     ) : null}
                   </div>
                   {application?.submission_type === 'consortium' && application?.consortium_companies && application.consortium_companies.length > 0 && (
                     <div className="space-y-2">
                       <p className="text-sm font-medium text-gray-700 mb-3">JV Partners Distribution:</p>
                       {application.consortium_companies.map((company) => {
                         const percentage = company.work_unit_percentage || 0
                         return (
                           <div key={company.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                             <span className="text-sm text-gray-700">{company.company_name}</span>
                             <div className="text-right">
                               <span className="text-sm font-medium text-gray-900">{percentage.toFixed(2)}%</span>
                             </div>
                           </div>
                         )
                       })}
                     </div>
                   )}
                 </CardContent>
               </Card>
             )}

             {/* Document List */}
             <Card>
               <CardHeader>
                 <CardTitle>Uploaded Documents</CardTitle>
               </CardHeader>
               <CardContent>
                 <div className="space-y-2">
                   {application?.documents?.map((doc) => (
                     <div key={doc.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                       <div className="flex items-center space-x-3">
                         <FileText className="w-5 h-5 text-teal-600" />
                         <div>
                           <p className="font-medium text-gray-900">{doc.document_label || doc.document_type}</p>
                           <p className="text-xs text-gray-500">{doc.file_name}</p>
                         </div>
                       </div>
                       <a 
                         href={doc.file_url} 
                         target="_blank" 
                         rel="noopener noreferrer"
                         className="text-teal-600 hover:text-teal-700"
                       >
                         <Download className="w-4 h-4" />
                       </a>
                     </div>
                   ))}
                   
                   {(!application?.documents || application.documents.length === 0) && (
                     <p className="text-gray-500 text-center py-4">No documents uploaded yet</p>
                   )}
                 </div>
               </CardContent>
             </Card>

            {/* Submit Section */}
            {!isSubmitted && (() => {
              // Check if work units are encrypted (work_units_encrypted_at is set)
              const hasEncryptedWorkUnits = !!application?.work_units_encrypted_at
              
              const isSubmitDisabled = Boolean(
                submitting 
                || docProgress.percentage < 100 
                || application?.application_fee_status !== 'paid' 
                || !hasEncryptedWorkUnits // Work units must be encrypted
              )
              
              return (
              <Card className="border-teal-200 bg-teal-50">
                <CardContent className="py-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-gray-900">Ready to Submit?</h3>
                      <p className="text-sm text-gray-600">
                        Please review all information before submitting. You cannot make changes after submission.
                      </p>
                    </div>
                     <div className="flex space-x-3">
                       <Button 
                         variant="outline" 
                         onClick={() => {
                           // Always go to documents step (work units can't be edited after encryption)
                           setCurrentStep(4)
                         }}
                       >
                         <ChevronLeft className="w-4 h-4 mr-2" />
                         Back to Documents
                       </Button>
                       <Button 
                         onClick={submitApplication}
                         disabled={isSubmitDisabled}
                         className="bg-green-600 hover:bg-green-700"
                       >
                         {submitting ? (
                           <>
                             <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                             Submitting...
                           </>
                         ) : (
                           <>
                             <Send className="w-4 h-4 mr-2" />
                             Submit Application
                           </>
                         )}
                       </Button>
                     </div>
                   </div>
                   
                   {docProgress.percentage < 100 && (
                     <p className="mt-3 text-sm text-red-600">
                       ⚠️ Please upload all required documents before submitting.
                     </p>
                   )}
                   
                   {application?.application_fee_status !== 'paid' && (
                     <p className="mt-3 text-sm text-red-600">
                       ⚠️ Please complete payment before submitting.
                     </p>
                   )}
                   
                   {!application?.work_units_encrypted_at && (
                     <p className="mt-3 text-sm text-red-600">
                       ⚠️ Please enter and save your work unit (must be 101 or above) before submitting.
                     </p>
                   )}
                </CardContent>
              </Card>
              )
            })()}
          </div>
        )}
      </div>
    </BiddingPortalLayout>
  )
}

