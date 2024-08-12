#!/usr/bin/env node
const puppeteer = require('puppeteer');
const hb = require('handlebars');
const core = require('@actions/core');
const {readFileSync} = require('fs');
const S3 = require('aws-sdk/clients/s3');
const {PDFDocument} = require('pdf-lib');
const {setOutput} = require('@actions/core');

const Bucket = core.getInput('bucket');
const baseUrl = core.getInput('baseUrl');
const basePdf = core.getInput('basePdf');
const pdfName = core.getInput('pdfName');


const s3 = new S3({
    region: core.getInput('region'),
    accessKeyId: core.getInput('accessKeyId'),
    secretAccessKey: core.getInput('secretAccessKey')
});

async function appendPDF(firstPdf, secondPdf) {
    console.log('Merging with base PDF');
    const first = await PDFDocument.load(firstPdf);
    const second = await PDFDocument.load(secondPdf);
    const pagesArray = await second.copyPages(first, first.getPageIndices());
    for (const page of pagesArray) {
        second.addPage(page);
    }
    return await second.save();
}

async function getReleaseDate() {
    /**
     * getting current date
     */
    return pdfName.match(/\d{2}-\d{2}-\d{4}/)[0];
}

async function getVersion(type) {
    /**
     * getting current version from input
     */
    const version = pdfName.split('-')[0];

    if (type === 'short') {
        return version.split('.')[0];
    }

    return version;
}

async function getAsset(file) {
    const params = {
        Bucket,
        Key: `assets/${file}`,
    };

    const {Body} = await s3
        .getObject(params)
        .promise()
        .catch((err) => console.log(err));
    return Body;
}

async function getAllFiles() {
    /**
     * getting all previous PDFs (above 1000 as well)
     */
    let isTruncated = true;
    let marker;
    const elements = [];
    while (isTruncated) {
        let params = {Bucket, Prefix: 'versions/'};
        if (marker) params.Marker = marker;
        try {
            const response = await s3.listObjects(params).promise();
            const objectsInFolder = response.Contents.filter((i) => i.Size > 0);

            objectsInFolder.forEach((item) => {
                elements.push(item.Key.split('/')[1]);
            });
            isTruncated = response.IsTruncated;
            if (isTruncated) {
                marker = response.Contents.slice(-1)[0].Key.split('/')[1];
            }
        } catch (error) {
            throw error;
        }
    }
    return elements;
}

async function checkIfFileExist(fileName) {
    const params = {
        Bucket,
        Key: `versions/${fileName}`,
    };

    return await s3
        .getObject(params)
        .promise()
        .then(() => {
            console.log("This PDF? 'Tis already there...");
            const PDF_URL = `${baseUrl}/versions/${fileName}`;
            setOutput('url', PDF_URL);
            return true;
        })
        .catch(() => {
            console.log("Item doesn't exists, onto creation...");
            return false;
        });
}

async function uploadFile(file, Key) {
    return await s3
        .upload({
            Bucket,
            Body: Buffer.from(file),
            Key,
            ContentType: 'application/pdf',
            ContentDisposition: 'inline',
            ACL: 'public-read',
        })
        .promise()
        .then(() => console.log(`Uploaded ${Key}`))
        .catch((err) => core.setFailed(err.message));
}

async function mapAllFiles(currentPdfName) {
    /**
     * map all version files to usable format for handlebars
     */
    const fileExists = await checkIfFileExist(currentPdfName);
    if (fileExists) return false;

    const previousFiles = await getAllFiles();
    const mapped = [];

    previousFiles.forEach((item) => {
        const build = item.split('-')[0];
        const date = item.match(/\d{2}-\d{2}-\d{4}/)[0];
        mapped.push({build, date});
    });

    // Sort versions numerically
    mapped.sort((a, b) => {
        // Extract the version numbers from the strings
        const versionA = a.build.split('-')[0].split('.').map(Number);
        const versionB = b.build.split('-')[0].split('.').map(Number);

        // Compare each part of the version number
        for (let i = 0; i < Math.max(versionA.length, versionB.length); i++) {
            const numA = versionA[i] || 0;
            const numB = versionB[i] || 0;
            if (numA !== numB) {
                return numA - numB;
            }
        }
        return 0;
    });

    return mapped;
}

async function getTemplateHtml(fileName) {
    /**
     * getting the html template
     */
    console.log(`Loading ${fileName} file in memory`);
    const templateBuffer = await getAsset(fileName).catch((err) => console.log("Can' load template: ", err));
    return Buffer.from(templateBuffer).toString('utf8');
}

async function generatePdf() {
    const mapped = await mapAllFiles(pdfName);
    if (!mapped) return;

    /**
     * downloading base PDF and templates
     */
    const basePDF = await getAsset(basePdf);
    const bodyTemplate = await getTemplateHtml('pdf_v2.html');
    const footerTemplate = await getTemplateHtml('footer.html');

    /**
     * creating the template from html using handlebars
     */
    const template = await hb.compile(bodyTemplate, {strict: true});
    const html = template({
        version: await getVersion(),
        shortVersion: await getVersion('short'),
        releaseDate: await getReleaseDate(),
        previousFiles: mapped,
        manufacturer: readFileSync('/assets/manufacturer.png').toString('base64'),
        dateManufacturer: readFileSync('/assets/dateManufacturer.png').toString('base64'),
        ref: readFileSync('/assets/ref.png').toString('base64'),
        lot: readFileSync('/assets/lot.png').toString('base64'),
        udi: readFileSync('/assets/udi.png').toString('base64'),
        ukca: readFileSync('/assets/ukca.png').toString('base64'),
        caution: readFileSync('/assets/caution.png').toString('base64'),
        eifu: readFileSync('/assets/eifu.png').toString('base64'),
        logo: readFileSync('/assets/logo.png').toString('base64'),
    });

    /**
     * launching puppeteer to generate the version PDF
     */
    console.log(`Starting PDF generation with ${pdfName} name`);
    const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        headless: true,
        executablePath: 'google-chrome-stable',
    });
    const page = await browser.newPage();
    await page.setContent(html, {waitUntil: ['load', 'domcontentloaded', 'networkidle0']});
    await page.addStyleTag({path: '/styles/pdf.css'});

    const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        displayHeaderFooter: true,
        footerTemplate,
        margin: {
            top: '1.2cm',
            bottom: '2.3cm',
            right: '1.5cm',
            left: '1.5cm',
        },
    });
    await browser.close();

    const mergedPdf = await appendPDF(basePDF, pdf);
    console.log('Done, starting the uploads...');

    /**
     * uploading PDF to S3
     */
    await uploadFile(mergedPdf, `versions/${pdfName}`);
    await uploadFile(mergedPdf, 'latest/Limbic Access - Instructions for Use (IFU).pdf');
}

async function generateDeviceLabel() {
    /**
     * Loading HTML template and assets
     */
    const bodyTemplate = await getTemplateHtml('device_label.html');

    /**
     * Creating the template from HTML using Handlebars
     */
    const template = hb.compile(bodyTemplate, {strict: true});
    const html = template({
        version: await getVersion(),
        shortVersion: await getVersion('short'),
        manufacturer: readFileSync('/assets/manufacturer.png').toString('base64'),
        dateManufacturer: readFileSync('/assets/dateManufacturer.png').toString('base64'),
        ref: readFileSync('/assets/ref.png').toString('base64'),
        lot: readFileSync('/assets/lot.png').toString('base64'),
        udi: readFileSync('/assets/udi.png').toString('base64'),
        ukca: readFileSync('/assets/ukca.png').toString('base64'),
        caution: readFileSync('/assets/caution.png').toString('base64'),
        eifu: readFileSync('/assets/eifu.png').toString('base64'),
        logo: readFileSync('/assets/logo.png').toString('base64'),
    });

    /**
     * Launching Puppeteer to generate the PNG image
     */
    console.log(`Starting device label generation`);
    const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        headless: true,
        executablePath: 'google-chrome-stable',
    });

    const page = await browser.newPage();

    // Set a larger viewport with a high device scale factor
    const largeWidth = 390; // 2x 195
    const largeHeight = 500; // 2x 250
    await page.setViewport({ width: largeWidth, height: largeHeight });
    await page.setContent(html, {waitUntil: ['load', 'domcontentloaded', 'networkidle0']});
    await page.addStyleTag({path: '/styles/device_label.css'});

    const pngBuffer = await page.screenshot({
        fullPage: true,
        omitBackground: false, // Keep the background color
        path: "device-label_noscale.png", // Save the PNG file with the specified name
    });

    await browser.close();

    console.log('Done, starting the uploads...');

    /**
     * uploading device label to S3
     */
    await uploadFile(pngBuffer, 'label/device-label_noscale.png');
}

async function generateAssets() {
    await generatePdf()
    await generateDeviceLabel()
}

generateAssets().catch((err) => core.setFailed(err.message));
