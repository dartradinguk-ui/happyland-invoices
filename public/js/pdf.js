/**
 * Happyland Bakery - PDF Generator
 * Uses jsPDF and jsPDF-AutoTable
 */

export function createInvoiceDoc(invoiceData) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  const {
    settings = {},
    invoiceNo,
    company,
    customerAddress,
    weekEndingFormatted,
    items = [],
    grandTotal = 0
  } = invoiceData;

  const businessName = settings.businessName || 'Happyland Bakery Ltd';
  const accountNo = settings.accountNumber || '30623245';
  const sortCode = settings.sortCode || '20-92-60';

  // Title / Metadata
  doc.setProperties({
    title: `Invoice ${invoiceNo}`,
    subject: `Invoice for ${company}`,
    author: businessName
  });

  // Header Title
  doc.setFontSize(20);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(146, 64, 14); // Warm bakery dark amber
  doc.text(businessName, 14, 20);

  // Invoice info block
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(11);
  doc.setFont(undefined, 'bold');
  doc.text(`Invoice No:`, 14, 32);
  doc.setFont(undefined, 'normal');
  doc.text(`${invoiceNo}`, 45, 32);

  doc.setFont(undefined, 'bold');
  doc.text(`Week Ending:`, 14, 40);
  doc.setFont(undefined, 'normal');
  doc.text(`${weekEndingFormatted}`, 45, 40);

  doc.setFont(undefined, 'bold');
  doc.text(`Invoice To:`, 14, 48);
  doc.setFont(undefined, 'normal');
  doc.text(`${company}`, 45, 48);

  if (customerAddress) {
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text(`${customerAddress}`, 45, 54);
  }

  // Format table rows
  const tableData = items.map(item => [
    item.name,
    item.mon || '',
    item.tues || '',
    item.wed || '',
    item.thu || '',
    item.fri || '',
    item.sat || '',
    item.sun || '',
    item.total || 0,
    `£${(item.cost || 0).toFixed(2)}`,
    `£${(item.itemTotal || 0).toFixed(2)}`
  ]);

  const startY = customerAddress ? 62 : 56;

  // Render Table with AutoTable
  // Total 11 columns: 0:Item, 1:Mon, 2:Tues, 3:Wed, 4:Thu, 5:Fri, 6:Sat, 7:Sun, 8:Total, 9:Cost, 10:ItemTotal
  doc.autoTable({
    startY: startY,
    head: [['Item', 'Mon', 'Tues', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Total', 'Cost', 'Total']],
    body: tableData,
    foot: [
      [
        { content: 'Sub Total:', colSpan: 10, styles: { halign: 'right', fontStyle: 'bold', fontSize: 10 } },
        { content: `£${grandTotal.toFixed(2)}`, styles: { halign: 'right', fontStyle: 'bold', fontSize: 10 } }
      ]
    ],
    margin: { top: 60, left: 14, right: 14 },
    theme: 'grid',
    styles: {
      fontSize: 9,
      cellPadding: 3,
      textColor: [30, 41, 59],
      lineColor: [203, 213, 225],
      lineWidth: 0.2
    },
    columnStyles: {
      0: { cellWidth: 42, halign: 'left' },
      1: { halign: 'center' },
      2: { halign: 'center' },
      3: { halign: 'center' },
      4: { halign: 'center' },
      5: { halign: 'center' },
      6: { halign: 'center' },
      7: { halign: 'center' },
      8: { halign: 'center', fontStyle: 'bold' },
      9: { halign: 'right' },
      10: { halign: 'right', fontStyle: 'bold' }
    },
    headStyles: {
      fillColor: [226, 232, 240], // Light slate gray
      textColor: [15, 23, 42],
      fontStyle: 'bold',
      halign: 'center'
    },
    footStyles: {
      fillColor: [248, 250, 252],
      textColor: [15, 23, 42]
    }
  });

  // Payment Details box
  const finalY = (doc.lastAutoTable ? doc.lastAutoTable.finalY : startY + 60) + 12;

  // Box background
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(14, finalY, 182, 36, 2, 2, 'FD');

  doc.setFontSize(11);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(businessName, 20, finalY + 8);

  doc.setFontSize(9.5);
  doc.setFont(undefined, 'bold');
  doc.text(`Invoice To:`, 20, finalY + 16);
  doc.setFont(undefined, 'normal');
  doc.text(`${company}`, 45, finalY + 16);

  doc.setFont(undefined, 'bold');
  doc.text(`Account Number:`, 20, finalY + 23);
  doc.setFont(undefined, 'normal');
  doc.text(`${accountNo}`, 55, finalY + 23);

  doc.setFont(undefined, 'bold');
  doc.text(`Sort Code:`, 20, finalY + 30);
  doc.setFont(undefined, 'normal');
  doc.text(`${sortCode}`, 55, finalY + 30);

  return doc;
}

export function generateFilename(company, invoiceNo) {
  const cleanCompany = (company || 'Customer').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `Happyland_Bakery_Invoice_${cleanCompany}_${invoiceNo}.pdf`;
}

export function downloadInvoicePdf(invoiceData) {
  const doc = createInvoiceDoc(invoiceData);
  const filename = generateFilename(invoiceData.company, invoiceData.invoiceNo);
  doc.save(filename);
}

export function getInvoicePdfBase64(invoiceData) {
  const doc = createInvoiceDoc(invoiceData);
  const dataUri = doc.output('datauristring');
  // Strip URI header if present
  return dataUri.replace(/^data:application\/pdf;base64,/, '');
}

export function getInvoicePdfBlob(invoiceData) {
  const doc = createInvoiceDoc(invoiceData);
  return doc.output('blob');
}

export function getInvoicePdfFile(invoiceData) {
  const blob = getInvoicePdfBlob(invoiceData);
  const filename = generateFilename(invoiceData.company, invoiceData.invoiceNo);
  return new File([blob], filename, { type: 'application/pdf', lastModified: Date.now() });
}
