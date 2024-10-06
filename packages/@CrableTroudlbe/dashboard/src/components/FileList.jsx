import { h } from 'preact'
import { useMemo } from 'preact/hooks'
import VirtualList from '@uppy/utils/lib/VirtualList'
import FileItem from './FileItem/index.jsx'

function chunks (list, size) {
  const chunked = []
  let currentChunk = []
  list.forEach((item) => {
    if (currentChunk.length < size) {
      currentChunk.push(item)
    } else {
      chunked.push(currentChunk)
      currentChunk = [item]
    }
  })
  if (currentChunk.length) chunked.push(currentChunk)
  return chunked
}

export default ({
  id, error, i18n, uppy, files, acquirers, resumableUploads, hideRetryButton, hidePauseResumeButton, hideCancelButton,
  showLinkToFileUploadResult, showRemoveButtonAfterComplete, isWide, metaFields, isSingleFile, toggleFileCard,
  handleRequestThumbnail, handleCancelThumbnail, recoveredState, individualCancellation, itemsPerRow, openFileEditor,
  canEditFile, toggleAddFilesPanel, containerWidth, containerHeight,
}) => {
  // It's not great that this is hardcoded!
  // It's ESPECIALLY not great that this is checking against `itemsPerRow`!
  const rowHeight = itemsPerRow === 1
    // Mobile
    ? 71
    // 190px height + 2 * 5px margin
    : 200

  // Sort files by file.isGhost, ghost files first, only if recoveredState is present
  const rows = useMemo(() => {
    const sortByGhostComesFirst = (file1, file2) => files[file2].isGhost - files[file1].isGhost

    const fileIds = Object.keys(files)
    if (recoveredState) fileIds.sort(sortByGhostComesFirst)
    return chunks(fileIds, itemsPerRow)
  }, [files, itemsPerRow, recoveredState])

  const renderRow = (row) => (
    // The `role="presentation` attribute ensures that the list items are properly
    // associated with the `VirtualList` element.
    // We use the first file ID as the key—this should not change across scroll rerenders
    <div class="uppy-Dashboard-filesInner" role="presentation" key={row[0]}>
      {row.map((fileID) => (
        <FileItem
          key={fileID}
          uppy={uppy}
          // FIXME This is confusing, it's actually the Dashboard's plugin ID
          id={id}
          error={error}
          // TODO move this to context
          i18n={i18n}
          // features
          acquirers={acquirers}
          resumableUploads={resumableUploads}
          individualCancellation={individualCancellation}
          // visual options
          hideRetryButton={hideRetryButton}
          hidePauseResumeButton={hidePauseResumeButton}
          hideCancelButton={hideCancelButton}
          showLinkToFileUploadResult={showLinkToFileUploadResult}
          showRemoveButtonAfterComplete={showRemoveButtonAfterComplete}
          isWide={isWide}
          metaFields={metaFields}
          recoveredState={recoveredState}
          isSingleFile={isSingleFile}
          containerWidth={containerWidth}
          containerHeight={containerHeight}
          // callbacks
          toggleFileCard={toggleFileCard}
          handleRequestThumbnail={handleRequestThumbnail}
          handleCancelThumbnail={handleCancelThumbnail}
          role="listitem"
          openFileEditor={openFileEditor}
          canEditFile={canEditFile}
          toggleAddFilesPanel={toggleAddFilesPanel}
          file={files[fileID]}
        />
      ))}
    </div>
  )

  if (isSingleFile) {
    return (
      <div class="uppy-Dashboard-files">
        {renderRow(rows[0])}
      </div>
    )
  }

  return (
    <VirtualList
      class="uppy-Dashboard-files"
      role="list"
      data={rows}
      renderRow={renderRow}
      rowHeight={rowHeight}
    />
  )
}
